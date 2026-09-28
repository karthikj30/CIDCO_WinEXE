import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { resolveHandshakeForRead } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/logs
 *
 * The architect's own timestamped view of the exchange — every validation,
 * token event and data transfer for their handshake (spec point 9).
 */
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveHandshakeForRead(req);
    if (!resolved.ok) return fail(resolved.reason, 401);

    const logs = await prisma.communicationLog.findMany({
      where: { handshakeId: resolved.handshake.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, direction: true, event: true, statusCode: true, detail: true, createdAt: true },
    });

    return ok({ clientId: resolved.handshake.clientId, count: logs.length, logs });
  } catch (error) {
    return handleError(error);
  }
}
