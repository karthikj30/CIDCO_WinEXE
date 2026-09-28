import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireArchitect } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/architect/deliveries/:id/ack
 *
 * The architect confirms they have saved the tokens. The plaintext is wiped
 * from the delivery, leaving only the prefixes and expiry dates on record.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireArchitect(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const delivery = await prisma.tokenDelivery.findUnique({
      where: { id },
      include: { handshake: { select: { architectId: true } } },
    });
    if (!delivery) return fail('Delivery not found', 404);
    if (delivery.handshake.architectId !== guard.user.id) {
      return fail('That delivery does not belong to you', 403);
    }

    await prisma.tokenDelivery.update({
      where: { id },
      data: { acknowledgedAt: new Date(), accessToken: null, refreshToken: null },
    });

    return ok({ message: 'Saved. The tokens are no longer shown on your dashboard.' });
  } catch (error) {
    return handleError(error);
  }
}
