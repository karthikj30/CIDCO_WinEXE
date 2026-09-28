import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleError, ok, unauthorized } from '@/lib/api';
import { aggregateAqi, countReadings, countReadingsBy, findReadings } from '@/lib/readings';

export const dynamic = 'force-dynamic';

/** GET /api/stats — the numbers behind the dashboard tiles. */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    // The tiles count every channel, so all three reading tables are in scope.
    const scope = auth.user.role === 'ARCHITECT' ? { userId: auth.user.id } : {};

    const [total, byStatus, bySource, aqi, recent] = await Promise.all([
      countReadings(scope),
      countReadingsBy('status', scope),
      countReadingsBy('source', scope),
      aggregateAqi(scope),
      findReadings({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, referenceNo: true, siteName: true, aqiValue: true, status: true, createdAt: true },
      }),
    ]);

    return ok({
      totalReports: total,
      byStatus,
      bySource,
      aqi: { average: aqi.average, max: aqi.max, min: aqi.min },
      recent,
    });
  } catch (error) {
    return handleError(error);
  }
}
