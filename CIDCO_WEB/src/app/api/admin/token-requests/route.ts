import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/** GET /api/admin/token-requests — renewal requests raised by architects. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const where: Prisma.TokenRequestWhereInput = {};
    if (status) where.status = status as Prisma.TokenRequestWhereInput['status'];

    const requests = await prisma.tokenRequest.findMany({
      where,
      // Pending first, then most recent.
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      include: {
        handshake: {
          select: {
            id: true,
            clientId: true,
            status: true,
            architect: { select: { name: true, email: true } },
          },
        },
      },
    });

    return ok({ tokenRequests: requests });
  } catch (error) {
    return handleError(error);
  }
}
