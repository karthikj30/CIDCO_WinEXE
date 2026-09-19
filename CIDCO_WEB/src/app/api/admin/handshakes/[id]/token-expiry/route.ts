import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { tokenExpirySchema } from '@/lib/validation';
import { clientIp, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/handshakes/:id/token-expiry
 *
 * CIDCO sets an explicit expiry date on the handshake's live token pair from
 * the dashboard — extending or cutting short the current access / refresh
 * window without re-issuing the tokens the architect already holds.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = tokenExpirySchema.parse(await req.json());
    if (!body.accessExpiresAt && !body.refreshExpiresAt) {
      return fail('Provide accessExpiresAt and/or refreshExpiresAt', 422);
    }

    const token = await prisma.integrationToken.findFirst({
      where: { handshakeId: id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) return fail('This handshake has no live token pair to update', 404);

    const accessExpiresAt = body.accessExpiresAt ?? token.expiresAt;
    const refreshExpiresAt = body.refreshExpiresAt ?? token.refreshExpiresAt;
    if (refreshExpiresAt && refreshExpiresAt.getTime() < accessExpiresAt.getTime()) {
      return fail('Refresh token cannot expire before the access token', 422);
    }

    const updated = await prisma.integrationToken.update({
      where: { id: token.id },
      data: { expiresAt: accessExpiresAt, refreshExpiresAt },
    });

    await logComm({
      handshakeId: id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKEN_EXPIRY_UPDATED',
      statusCode: 200,
      detail: `Live token expiry set — access ${updated.expiresAt.toISOString()}, refresh ${updated.refreshExpiresAt?.toISOString() ?? 'n/a'}`,
      ip: clientIp(req),
    });

    return ok({
      message: 'Token expiry updated.',
      token: {
        id: updated.id,
        prefix: updated.prefix,
        expiresAt: updated.expiresAt,
        refreshExpiresAt: updated.refreshExpiresAt,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
