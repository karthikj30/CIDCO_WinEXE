import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/** GET /api/admin/handshakes/:id — full detail: tokens, requests, comm log. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const handshake = await prisma.architectHandshake.findUnique({
      where: { id },
      include: {
        // Includes the details the architect filled in when they set up their
        // own login, so the officer sees who is actually on the other end.
        architect: {
          select: {
            id: true,
            name: true,
            email: true,
            firmName: true,
            councilRegNo: true,
            phone: true,
            designation: true,
            address: true,
            accountSetupAt: true,
          },
        },
        tokens: { orderBy: { createdAt: 'desc' } },
        tokenRequests: { orderBy: { requestedAt: 'desc' } },
        commLogs: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!handshake) return fail('Handshake not found', 404);

    const now = Date.now();
    return ok({
      handshake: {
        id: handshake.id,
        clientId: handshake.clientId,
        secretPrefix: handshake.secretPrefix,
        status: handshake.credentialExpiresAt.getTime() < now && handshake.status !== 'REVOKED' ? 'EXPIRED' : handshake.status,
        credentialExpiresAt: handshake.credentialExpiresAt,
        architectValidatedAt: handshake.architectValidatedAt,
        establishedAt: handshake.establishedAt,
        lastValidatedIp: handshake.lastValidatedIp,
        architect: handshake.architect,
        createdAt: handshake.createdAt,
        // Whitelist + token policy, edited from the dashboard.
        whitelistedIp: handshake.whitelistedIp,
        deviceInfo: handshake.deviceInfo,
        whitelistedAt: handshake.whitelistedAt,
        enforceWhitelist: handshake.enforceWhitelist,
        accessTokenTtlDays: handshake.accessTokenTtlDays,
        refreshTokenTtlDays: handshake.refreshTokenTtlDays,
        tokens: handshake.tokens.map((t) => ({
          id: t.id,
          prefix: t.prefix,
          expiresAt: t.expiresAt,
          refreshPrefix: t.refreshTokenPrefix,
          refreshExpiresAt: t.refreshExpiresAt,
          revokedAt: t.revokedAt,
          lastUsedAt: t.lastUsedAt,
          createdAt: t.createdAt,
          // A pair is live only while BOTH windows are open (CASE 3).
          active:
            !t.revokedAt &&
            t.expiresAt.getTime() > now &&
            !!t.refreshExpiresAt &&
            t.refreshExpiresAt.getTime() > now,
          refreshExpired: !t.refreshExpiresAt || t.refreshExpiresAt.getTime() <= now,
        })),
        tokenRequests: handshake.tokenRequests,
        commLogs: handshake.commLogs,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
