import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/validation-requests
 *
 * The approval queue: architects who have hit the API with their credentials
 * and are waiting for CIDCO to verify their identity, IP and device.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    // This queue is the API channel's; SFTP has its own at /api/admin/sftp.
    const where: Prisma.ValidationRequestWhereInput = { channel: 'API' };
    if (status) where.status = status as Prisma.ValidationRequestWhereInput['status'];

    const requests = await prisma.validationRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        handshake: {
          select: {
            id: true,
            clientId: true,
            status: true,
            whitelistedIp: true,
            deviceInfo: true,
            accessTokenTtlDays: true,
            refreshTokenTtlDays: true,
            architect: { select: { id: true, name: true, email: true, firmName: true, councilRegNo: true } },
          },
        },
      },
    });

    return ok({ requests });
  } catch (error) {
    return handleError(error);
  }
}
