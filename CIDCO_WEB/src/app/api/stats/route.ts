import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleError, ok, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** GET /api/stats — the numbers behind the dashboard tiles. */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const scope: Prisma.ReportWhereInput =
      auth.user.role === 'ARCHITECT' ? { userId: auth.user.id } : {};

    const [total, byStatus, bySource, aggregate, recent] = await Promise.all([
      prisma.report.count({ where: scope }),
      prisma.report.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      prisma.report.groupBy({ by: ['source'], where: scope, _count: { _all: true } }),
      prisma.report.aggregate({ where: scope, _avg: { aqiValue: true }, _max: { aqiValue: true }, _min: { aqiValue: true } }),
      prisma.report.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, referenceNo: true, siteName: true, aqiValue: true, status: true, createdAt: true },
      }),
    ]);

    return ok({
      totalReports: total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count._all])),
      aqi: {
        average: aggregate._avg.aqiValue ? Math.round(aggregate._avg.aqiValue) : null,
        max: aggregate._max.aqiValue,
        min: aggregate._min.aqiValue,
      },
      recent,
    });
  } catch (error) {
    return handleError(error);
  }
}
