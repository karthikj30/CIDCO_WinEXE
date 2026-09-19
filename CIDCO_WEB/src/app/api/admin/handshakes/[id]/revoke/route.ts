import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { clientIp, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/** POST /api/admin/handshakes/:id/revoke — close the channel and kill its tokens. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const handshake = await prisma.architectHandshake.findUnique({ where: { id } });
    if (!handshake) return fail('Handshake not found', 404);

    await prisma.$transaction([
      prisma.architectHandshake.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      }),
      prisma.integrationToken.updateMany({
        where: { handshakeId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await logComm({
      handshakeId: id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'HANDSHAKE_REVOKED',
      statusCode: 200,
      detail: `Handshake ${handshake.clientId} revoked; all tokens invalidated`,
      ip: clientIp(req),
    });

    return ok({ message: 'Handshake revoked and tokens invalidated', id });
  } catch (error) {
    return handleError(error);
  }
}
