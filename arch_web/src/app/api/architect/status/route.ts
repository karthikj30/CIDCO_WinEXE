import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { resolveHandshakeForRead } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/status
 *
 * Lets the architect check where the handshake stands — established or not,
 * credential expiry, and whether a live token exists.
 */
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveHandshakeForRead(req);
    if (!resolved.ok) return fail(resolved.reason, 401);
    const h = resolved.handshake;
    const now = Date.now();

    const activeToken = await prisma.integrationToken.findFirst({
      where: { handshakeId: h.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
      select: { prefix: true, expiresAt: true },
    });

    const pendingRequests = await prisma.tokenRequest.count({
      where: { handshakeId: h.id, status: 'PENDING' },
    });

    return ok({
      clientId: h.clientId,
      status: h.credentialExpiresAt.getTime() < now && h.status !== 'REVOKED' ? 'EXPIRED' : h.status,
      established: h.status === 'ESTABLISHED' && h.credentialExpiresAt.getTime() >= now,
      credentialExpiresAt: h.credentialExpiresAt,
      establishedAt: h.establishedAt,
      activeToken: activeToken ? { prefix: activeToken.prefix, expiresAt: activeToken.expiresAt } : null,
      pendingTokenRequests: pendingRequests,
    });
  } catch (error) {
    return handleError(error);
  }
}
