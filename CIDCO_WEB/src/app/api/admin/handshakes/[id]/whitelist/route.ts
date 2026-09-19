import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { clientIp, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/handshakes/:id/whitelist
 *
 * Clears the recorded IP / device so the architect can register a new machine
 * on their next validate — the escape hatch when a station is replaced or its
 * IP changes.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const existing = await prisma.architectHandshake.findUnique({ where: { id } });
    if (!existing) return fail('Handshake not found', 404);

    await prisma.architectHandshake.update({
      where: { id },
      data: { whitelistedIp: null, deviceInfo: null, deviceFingerprint: null, whitelistedAt: null },
    });

    await logComm({
      handshakeId: id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'WHITELIST_RESET',
      statusCode: 200,
      detail: `Whitelist cleared (was ${existing.whitelistedIp ?? 'unset'}); the next validate will register a new IP/device`,
      ip: clientIp(req),
    });

    return ok({ message: 'Whitelist cleared. The next successful validate will register a new IP and device.' });
  } catch (error) {
    return handleError(error);
  }
}
