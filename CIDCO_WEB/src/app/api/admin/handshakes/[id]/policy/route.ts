import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { tokenPolicySchema } from '@/lib/validation';
import { clientIp, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/handshakes/:id/policy
 *
 * CIDCO sets the token expiry policy (access / refresh TTL in days) and whether
 * the IP whitelist is enforced. Saved on the handshake, so the next token the
 * API issues — by validate, refresh or the dashboard — uses these windows.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = tokenPolicySchema.parse(await req.json());
    if (
      body.accessTokenTtlDays === undefined &&
      body.refreshTokenTtlDays === undefined &&
      body.enforceWhitelist === undefined
    ) {
      return fail('Nothing to update', 422);
    }

    const existing = await prisma.architectHandshake.findUnique({ where: { id } });
    if (!existing) return fail('Handshake not found', 404);

    const accessTtl = body.accessTokenTtlDays ?? existing.accessTokenTtlDays;
    const refreshTtl = body.refreshTokenTtlDays ?? existing.refreshTokenTtlDays;
    if (refreshTtl < accessTtl) {
      return fail('Refresh token expiry must be at least as long as the access token expiry', 422);
    }

    const updated = await prisma.architectHandshake.update({
      where: { id },
      data: {
        accessTokenTtlDays: accessTtl,
        refreshTokenTtlDays: refreshTtl,
        enforceWhitelist: body.enforceWhitelist ?? existing.enforceWhitelist,
      },
    });

    await logComm({
      handshakeId: id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKEN_POLICY_UPDATED',
      statusCode: 200,
      detail: `Token policy set to access ${accessTtl}d / refresh ${refreshTtl}d; IP whitelist ${updated.enforceWhitelist ? 'enforced' : 'not enforced'}`,
      ip: clientIp(req),
    });

    return ok({
      message: 'Token policy updated. It applies to the next token issued.',
      policy: {
        accessTokenTtlDays: updated.accessTokenTtlDays,
        refreshTokenTtlDays: updated.refreshTokenTtlDays,
        enforceWhitelist: updated.enforceWhitelist,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
