import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import { REFRESH_TOKEN_PREFIX, clientIp, logComm, sha256 } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

const schema = z.object({
  refreshToken: z.string().min(5, 'refreshToken is required'),
  reason: z.string().max(300).optional(),
});

/**
 * POST /api/architect/token-requests
 *
 * CASE 2 — the access token expired. The architect raises a request with the
 * refresh token CIDCO gave them. The request lands on the CIDCO dashboard;
 * an officer verifies the refresh token and issues a new access token, which
 * is delivered back to the architect's dashboard.
 */
export async function POST(req: NextRequest) {
  return withLogging(
    req,
    async (req) => {
      try {
        const ip = clientIp(req);
        const { refreshToken, reason } = schema.parse(await req.json());

        if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
          return fail('That does not look like a CIDCO refresh token', 422);
        }

        const hash = sha256(refreshToken);
        const token = await prisma.integrationToken.findUnique({
          where: { refreshTokenHash: hash },
          include: { handshake: true },
        });
        if (!token) return fail('Unknown refresh token', 401);
        if (token.revokedAt) return fail('That token pair has been revoked', 401);
        if (token.handshake.status !== 'ESTABLISHED') {
          return fail('Your handshake is not established. Validate with your user id and password first.', 409);
        }

        const refreshDead = !token.refreshExpiresAt || token.refreshExpiresAt.getTime() < Date.now();
        const kind = refreshDead ? 'FULL_REISSUE' : 'ACCESS_RENEWAL';

        if (refreshDead) {
          return fail(
            'Your refresh token has also expired. Please hit the validate API again with the user id and password CIDCO gave you, so CIDCO can issue a new access token and refresh token.',
            503,
            { reason: 'BOTH_EXPIRED', action: 'POST /api/architect/validate with your clientId and clientSecret' },
          );
        }

        const open = await prisma.tokenRequest.findFirst({
          where: { handshakeId: token.handshakeId, status: 'PENDING' },
        });
        if (open) {
          return ok(
            {
              message: 'You already have a token request awaiting CIDCO approval.',
              request: { id: open.id, status: open.status, requestedAt: open.requestedAt },
            },
            202,
          );
        }

        const request = await prisma.tokenRequest.create({
          data: {
            handshakeId: token.handshakeId,
            reason: reason ?? null,
            kind,
            refreshTokenHash: hash,
            requestedIp: ip,
          },
        });

        await logComm({
          handshakeId: token.handshakeId,
          direction: 'ARCHITECT_TO_ADMIN',
          event: 'TOKEN_REQUESTED',
          statusCode: 202,
          detail: `Access token requested with refresh token ${token.refreshTokenPrefix}…${reason ? ` — ${reason}` : ''}`,
          ip,
        });

        return ok(
          {
            message:
              'Request sent to CIDCO. Once an officer verifies your refresh token, your new access token will appear on your dashboard.',
            request: { id: request.id, status: request.status, kind, requestedAt: request.requestedAt },
          },
          202,
        );
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false },
  );
}
