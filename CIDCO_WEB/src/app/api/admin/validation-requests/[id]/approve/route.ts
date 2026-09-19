import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import {
  clientIp,
  deliverTokens,
  fingerprintDevice,
  issueTokenPair,
  logComm,
} from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/validation-requests/:id/approve
 *
 * The officer has checked the architect, the IP and the device. Approving
 * whitelists them, establishes the channel, generates the access + refresh
 * pair and delivers both to the architect's dashboard as a message.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;
    const ip = clientIp(req);
    const baseUrl = new URL(req.url).origin;

    const request = await prisma.validationRequest.findUnique({
      where: { id },
      include: { handshake: { include: { architect: { select: { email: true } } } } },
    });
    if (!request) return fail('Validation request not found', 404);
    if (request.status !== 'PENDING') return fail(`This request is already ${request.status}`, 409);

    const hs = request.handshake;
    if (hs.revokedAt || hs.status === 'REVOKED') return fail('This handshake has been revoked', 409);
    if (hs.credentialExpiresAt.getTime() < Date.now()) {
      return fail('The architect credential has expired — issue new credentials instead', 409);
    }

    const now = new Date();

    // Register the IP/device the architect presented, and open the channel.
    await prisma.architectHandshake.update({
      where: { id: hs.id },
      data: {
        status: 'ESTABLISHED',
        establishedAt: hs.establishedAt ?? now,
        whitelistedIp: hs.whitelistedIp ?? request.presentedIp,
        deviceInfo: request.deviceInfo ?? hs.deviceInfo,
        deviceFingerprint: request.deviceInfo ? fingerprintDevice(request.deviceInfo) : hs.deviceFingerprint,
        whitelistedAt: hs.whitelistedAt ?? (request.presentedIp ? now : null),
      },
    });

    const issued = await issueTokenPair({
      handshakeId: hs.id,
      accessTtlDays: hs.accessTokenTtlDays,
      refreshTtlDays: hs.refreshTokenTtlDays,
      createdById: guard.user.id,
    });

    await prisma.validationRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: guard.user.id, reviewedAt: now },
    });

    await deliverTokens({
      handshakeId: hs.id,
      kind: 'INITIAL_PAIR',
      message:
        'Your API request has been validated by CIDCO. Here are your access token and refresh token — keep them safely. Save the access token on this dashboard and start automated sending.',
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessPrefix: issued.record.prefix,
      refreshPrefix: issued.record.refreshTokenPrefix,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
      baseUrl,
    });

    await logComm({
      handshakeId: hs.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'VALIDATION_APPROVED',
      statusCode: 200,
      detail: `Validated ${hs.architect.email} from IP ${request.presentedIp ?? 'unknown'}${request.deviceInfo ? ` · ${request.deviceInfo}` : ''}`,
      ip,
    });
    await logComm({
      handshakeId: hs.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKENS_DELIVERED',
      statusCode: 200,
      detail: `Access token (${issued.accessTtlDays}d) and refresh token (${issued.refreshTtlDays}d) delivered to the architect's dashboard`,
      ip,
    });

    return ok({
      message: 'Approved. Access and refresh tokens delivered to the architect’s dashboard.',
      handshake: { id: hs.id, clientId: hs.clientId, status: 'ESTABLISHED' },
      whitelistedIp: hs.whitelistedIp ?? request.presentedIp,
      deviceInfo: request.deviceInfo ?? hs.deviceInfo,
      token: {
        accessPrefix: issued.record.prefix,
        refreshPrefix: issued.record.refreshTokenPrefix,
        accessExpiresAt: issued.accessExpiresAt,
        refreshExpiresAt: issued.refreshExpiresAt,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
