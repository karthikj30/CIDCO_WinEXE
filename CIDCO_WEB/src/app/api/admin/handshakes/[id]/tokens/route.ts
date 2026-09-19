import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { generateTokenSchema } from '@/lib/validation';
import {
  addDays,
  clientIp,
  generateRefreshToken,
  generateToken,
  issueTokenPair,
  logComm,
  verifyCredentials,
} from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/handshakes/:id/tokens
 *
 * Once a handshake is ESTABLISHED, the admin mints an API token for it "using
 * its user id and password" — the clientId + clientSecret must be supplied and
 * must match. Tokens expire (default 7 days). The plaintext token is returned
 * once; the architect sends data with it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = generateTokenSchema.parse(await req.json());

    const handshake = await prisma.architectHandshake.findUnique({ where: { id } });
    if (!handshake) return fail('Handshake not found', 404);
    if (handshake.clientId !== body.clientId) {
      return fail('clientId does not match this handshake', 422);
    }

    const check = await verifyCredentials(body.clientId, body.clientSecret);
    if (!check.ok) return fail(check.reason, 422);
    if (check.handshake.status !== 'ESTABLISHED') {
      return fail('Handshake must be ESTABLISHED before a token can be generated. The architect must validate first.', 409);
    }

    const accessTtl = body.expiresInDays ?? handshake.accessTokenTtlDays;
    const refreshTtl = body.refreshExpiresInDays ?? handshake.refreshTokenTtlDays;
    const mode = body.mode ?? 'both';
    const ip = clientIp(req);

    // --- both: a fresh pair, revoking whatever came before -------------------
    if (mode === 'both') {
      const issued = await issueTokenPair({
        handshakeId: handshake.id,
        accessTtlDays: accessTtl,
        refreshTtlDays: refreshTtl,
        createdById: guard.user.id,
      });

      await logComm({
        handshakeId: handshake.id,
        direction: 'ADMIN_TO_ARCHITECT',
        event: 'TOKEN_GENERATED',
        statusCode: 201,
        detail: `Access token ${issued.record.prefix}… (${accessTtl}d) and refresh token ${issued.record.refreshTokenPrefix}… (${refreshTtl}d) issued from the dashboard; previous tokens revoked`,
        ip,
      });

      return ok(
        {
          message: 'Access and refresh tokens generated. Give both to the architect — shown only once.',
          mode,
          token: {
            id: issued.record.id,
            token: issued.accessToken, // back-compat alias
            accessToken: issued.accessToken,
            refreshToken: issued.refreshToken,
            prefix: issued.record.prefix,
            refreshPrefix: issued.record.refreshTokenPrefix,
            expiresAt: issued.accessExpiresAt,
            refreshExpiresAt: issued.refreshExpiresAt,
            expiresInDays: accessTtl,
            refreshExpiresInDays: refreshTtl,
            usage: 'Authorization: Bearer <accessToken> to POST /api/architect/data',
          },
        },
        201,
      );
    }

    // --- access / refresh: regenerate one half of the live pair --------------
    const live = await prisma.integrationToken.findFirst({
      where: { handshakeId: handshake.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!live) {
      return fail(
        'This handshake has no live token pair yet. Generate both tokens first.',
        409,
      );
    }

    if (mode === 'access') {
      const access = generateToken();
      const updated = await prisma.integrationToken.update({
        where: { id: live.id },
        data: {
          tokenHash: access.tokenHash,
          prefix: access.prefix,
          expiresAt: addDays(new Date(), accessTtl),
        },
      });

      await logComm({
        handshakeId: handshake.id,
        direction: 'ADMIN_TO_ARCHITECT',
        event: 'TOKEN_GENERATED',
        statusCode: 201,
        detail: `New access token ${access.prefix}… (${accessTtl}d) issued from the dashboard; refresh token unchanged`,
        ip,
      });

      return ok(
        {
          message: 'New access token generated. The refresh token is unchanged.',
          mode,
          token: {
            id: updated.id,
            token: access.token,
            accessToken: access.token,
            refreshToken: null,
            prefix: updated.prefix,
            refreshPrefix: updated.refreshTokenPrefix,
            expiresAt: updated.expiresAt,
            refreshExpiresAt: updated.refreshExpiresAt,
            expiresInDays: accessTtl,
            usage: 'Authorization: Bearer <accessToken> to POST /api/architect/data',
          },
        },
        201,
      );
    }

    // mode === 'refresh'
    const refresh = generateRefreshToken();
    const updated = await prisma.integrationToken.update({
      where: { id: live.id },
      data: {
        refreshTokenHash: refresh.tokenHash,
        refreshTokenPrefix: refresh.prefix,
        refreshExpiresAt: addDays(new Date(), refreshTtl),
      },
    });

    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKEN_GENERATED',
      statusCode: 201,
      detail: `New refresh token ${refresh.prefix}… (${refreshTtl}d) issued from the dashboard; access token unchanged`,
      ip,
    });

    return ok(
      {
        message: 'New refresh token generated. The access token is unchanged.',
        mode,
        token: {
          id: updated.id,
          token: null,
          accessToken: null,
          refreshToken: refresh.token,
          prefix: updated.prefix,
          refreshPrefix: updated.refreshTokenPrefix,
          expiresAt: updated.expiresAt,
          refreshExpiresAt: updated.refreshExpiresAt,
          refreshExpiresInDays: refreshTtl,
          usage: 'POST /api/architect/refresh with this refresh token to renew the access token',
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
