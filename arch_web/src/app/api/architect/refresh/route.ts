import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import {
  MSG_BOTH_EXPIRED,
  REFRESH_TOKEN_PREFIX,
  addDays,
  checkWhitelist,
  clientIp,
  generateToken,
  logComm,
  sha256,
} from '@/lib/handshake';

export const dynamic = 'force-dynamic';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * POST /api/architect/refresh
 *
 * CASE 2 — the access token expired. The architect presents the refresh token
 * and CIDCO validates it, then issues a **new access token**. The refresh token
 * itself is left in place until its own 30-day window closes, so an unattended
 * feed can never lock itself out by losing a rotated refresh token.
 *
 * CASE 3 — if the refresh token has also expired, the pair is dead: the
 * architect must re-authenticate with the user id and password.
 */
export async function POST(req: NextRequest) {
  return withLogging(
    req,
    async (req) => {
      try {
        const ip = clientIp(req);

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return fail('Invalid JSON body', 400);
        }

        const parsed = refreshSchema.safeParse(body);
        if (!parsed.success) return fail('Missing or invalid refreshToken', 400);
        const { refreshToken } = parsed.data;

        if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
          return fail('Invalid refresh token format', 401);
        }

        const record = await prisma.integrationToken.findUnique({
          where: { refreshTokenHash: sha256(refreshToken) },
          include: { handshake: true },
        });

        if (!record) return fail('Invalid refresh token', 401);
        if (record.revokedAt) return fail('This token pair has been revoked', 401);

        // CASE 3 — refresh window closed: send them back to user id + password.
        if (!record.refreshExpiresAt || record.refreshExpiresAt.getTime() < Date.now()) {
          await logComm({
            handshakeId: record.handshakeId,
            direction: 'ADMIN_TO_ARCHITECT',
            event: 'DATA_REJECTED',
            statusCode: 503,
            detail: 'Refresh token expired — architect must re-authenticate with user id and password',
            ip,
          });
          return fail(MSG_BOTH_EXPIRED, 503, {
            reason: 'BOTH_EXPIRED',
            action: 'POST /api/architect/validate with your clientId and clientSecret',
          });
        }

        if (record.handshake.status !== 'ESTABLISHED') {
          return fail('Handshake is not established', 401);
        }

        const gate = checkWhitelist(record.handshake, ip);
        if (!gate.ok) return fail(gate.reason, 403);

        await logComm({
          handshakeId: record.handshakeId,
          direction: 'ARCHITECT_TO_ADMIN',
          event: 'TOKEN_REQUESTED',
          statusCode: 200,
          detail: 'Refresh token presented to renew the access token',
          ip,
        });

        // Issue a new access token on the same row; the refresh token stands.
        const access = generateToken();
        const ttlDays = record.handshake.accessTokenTtlDays;
        const updated = await prisma.integrationToken.update({
          where: { id: record.id },
          data: {
            tokenHash: access.tokenHash,
            prefix: access.prefix,
            expiresAt: addDays(new Date(), ttlDays),
          },
        });

        await logComm({
          handshakeId: record.handshakeId,
          direction: 'ADMIN_TO_ARCHITECT',
          event: 'TOKEN_GENERATED',
          statusCode: 200,
          detail: `New access token ${access.prefix}… issued via refresh, valid ${ttlDays} day(s)`,
          ip,
        });

        return ok({
          message: 'Access token renewed. Keep using your existing refresh token.',
          accessToken: access.token,
          expiresInDays: ttlDays,
          accessTokenExpiresAt: updated.expiresAt,
          refreshTokenExpiresAt: updated.refreshExpiresAt,
        });
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false },
  );
}
