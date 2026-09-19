import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { clientIp, deliverTokens, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

const rejectSchema = z.object({ reviewNote: z.string().max(300).optional() });

/**
 * POST /api/admin/validation-requests/:id/reject
 *
 * The officer does not recognise the architect, IP or device. No tokens are
 * issued; the architect is told why on their dashboard.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;
    const body = rejectSchema.parse(await req.json().catch(() => ({})));

    const request = await prisma.validationRequest.findUnique({
      where: { id },
      include: { handshake: true },
    });
    if (!request) return fail('Validation request not found', 404);
    if (request.status !== 'PENDING') return fail(`This request is already ${request.status}`, 409);

    const now = new Date();
    await prisma.validationRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: guard.user.id, reviewedAt: now, reviewNote: body.reviewNote ?? null },
    });

    // Only drop the handshake back if it was never established.
    if (request.handshake.status === 'AWAITING_APPROVAL') {
      await prisma.architectHandshake.update({
        where: { id: request.handshakeId },
        data: { status: 'REJECTED' },
      });
    }

    await deliverTokens({
      handshakeId: request.handshakeId,
      kind: 'INITIAL_PAIR',
      message: `CIDCO could not validate your request${body.reviewNote ? `: ${body.reviewNote}` : '.'} No tokens were issued. Please check your credentials, IP address and device details with CIDCO and try again.`,
    });

    await logComm({
      handshakeId: request.handshakeId,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'VALIDATION_REJECTED',
      statusCode: 403,
      detail: body.reviewNote ?? 'Validation request rejected by CIDCO',
      ip: clientIp(req),
    });

    return ok({ message: 'Validation request rejected. The architect has been told on their dashboard.' });
  } catch (error) {
    return handleError(error);
  }
}
