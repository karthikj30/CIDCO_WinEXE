import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { approveRequestSchema } from '@/lib/validation';
import {
  addDays,
  clientIp,
  deliverTokens,
  generateToken,
  issueTokenPair,
  logComm,
} from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/token-requests/:id/approve
 *
 * The officer verifies the refresh token the architect presented and issues a
 * new access token, delivered to the architect's dashboard. The refresh token
 * itself is left alone until its own window closes.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;
    const ip = clientIp(req);
    const baseUrl = new URL(req.url).origin;

    const body = approveRequestSchema.parse(await req.json().catch(() => ({})));

    const request = await prisma.tokenRequest.findUnique({
      where: { id },
      include: { handshake: true },
    });
    if (!request) return fail('Token request not found', 404);
    if (request.status !== 'PENDING') return fail(`Request is already ${request.status}`, 409);
    if (request.handshake.status !== 'ESTABLISHED') {
      return fail('The handshake is not established; cannot issue a token', 409);
    }

    const accessTtl = body.expiresInDays ?? request.handshake.accessTokenTtlDays;
    const now = new Date();

    // --- Verify the refresh token the architect presented ---------------------
    // The request stores its hash, so approval proves the architect really held
    // a live refresh token for this handshake.
    const live = request.refreshTokenHash
      ? await prisma.integrationToken.findUnique({ where: { refreshTokenHash: request.refreshTokenHash } })
      : await prisma.integrationToken.findFirst({
          where: { handshakeId: request.handshakeId, revokedAt: null },
          orderBy: { createdAt: 'desc' },
        });

    if (!live || live.handshakeId !== request.handshakeId) {
      return fail('The refresh token on this request no longer matches a token for this handshake', 409);
    }
    if (live.revokedAt) return fail('That token pair has been revoked', 409);

    const refreshDead = !live.refreshExpiresAt || live.refreshExpiresAt.getTime() < now.getTime();

    // Refresh still good → new access token only (the architect keeps theirs).
    if (!refreshDead) {
      const access = generateToken();
      const updated = await prisma.integrationToken.update({
        where: { id: live.id },
        data: { tokenHash: access.tokenHash, prefix: access.prefix, expiresAt: addDays(now, accessTtl) },
      });

      await prisma.tokenRequest.update({
        where: { id: request.id },
        data: { status: 'FULFILLED', resolvedAt: now, resolvedById: guard.user.id, issuedTokenId: updated.id },
      });

      await deliverTokens({
        handshakeId: request.handshakeId,
        kind: 'ACCESS_RENEWAL',
        message:
          'CIDCO verified your refresh token. Here is your new access token — update it on your dashboard and restart automated sending. Your refresh token is unchanged.',
        accessToken: access.token,
        accessPrefix: access.prefix,
        accessExpiresAt: updated.expiresAt,
        refreshExpiresAt: updated.refreshExpiresAt,
        baseUrl,
      });

      await logComm({
        handshakeId: request.handshakeId,
        direction: 'ADMIN_TO_ARCHITECT',
        event: 'TOKENS_DELIVERED',
        statusCode: 200,
        detail: `Refresh token verified; new access token ${access.prefix}… (${accessTtl}d) delivered to the architect's dashboard`,
        ip,
      });

      return ok({
        message: 'Approved. New access token delivered to the architect’s dashboard.',
        kind: 'ACCESS_RENEWAL',
        token: { accessPrefix: access.prefix, expiresAt: updated.expiresAt, expiresInDays: accessTtl },
      });
    }

    // Refresh has lapsed → issue a whole new pair.
    const issued = await issueTokenPair({
      handshakeId: request.handshakeId,
      accessTtlDays: accessTtl,
      refreshTtlDays: request.handshake.refreshTokenTtlDays,
      createdById: guard.user.id,
      fromRequestId: request.id,
    });

    await prisma.tokenRequest.update({
      where: { id: request.id },
      data: { status: 'FULFILLED', resolvedAt: now, resolvedById: guard.user.id, issuedTokenId: issued.record.id },
    });

    await deliverTokens({
      handshakeId: request.handshakeId,
      kind: 'FULL_REISSUE',
      message:
        'Your refresh token had expired, so CIDCO has issued a new access token and a new refresh token. Keep both safely and update the access token on your dashboard.',
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessPrefix: issued.record.prefix,
      refreshPrefix: issued.record.refreshTokenPrefix,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
      baseUrl,
    });

    await logComm({
      handshakeId: request.handshakeId,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKENS_DELIVERED',
      statusCode: 200,
      detail: `Refresh had expired — new access + refresh pair delivered to the architect's dashboard`,
      ip,
    });

    return ok({
      message: 'Approved. A new access and refresh token pair was delivered to the architect’s dashboard.',
      kind: 'FULL_REISSUE',
      token: {
        accessPrefix: issued.record.prefix,
        refreshPrefix: issued.record.refreshTokenPrefix,
        expiresAt: issued.accessExpiresAt,
        refreshExpiresAt: issued.refreshExpiresAt,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
