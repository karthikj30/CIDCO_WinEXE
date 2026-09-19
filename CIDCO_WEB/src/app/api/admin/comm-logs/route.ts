import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/comm-logs — the timestamped handshake + data-transfer trail
 * for the admin dashboard (spec point 9).
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const handshakeId = url.searchParams.get('handshakeId');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));

    const where: Prisma.CommunicationLogWhereInput = {};
    if (handshakeId) where.handshakeId = handshakeId;

    const logs = await prisma.communicationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        handshake: { select: { clientId: true, architect: { select: { name: true, email: true } } } },
      },
    });

    return ok({ logs });
  } catch (error) {
    return handleError(error);
  }
}
