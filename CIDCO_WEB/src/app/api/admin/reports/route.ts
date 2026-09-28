import type { NextRequest } from 'next/server';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { channelsFor, countReadings, findReadings } from '@/lib/readings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/reports
 *
 * The AQI readings table for the dashboard's live database view. Officer-only.
 * Deliberately NOT wrapped in withLogging so live polling doesn't flood the
 * API request log.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') ?? 25)));
    const source = url.searchParams.get('source');
    const search = url.searchParams.get('q')?.trim();

    // A source filter narrows the query to that channel's table; without one
    // the page is merged from all three.
    // A source filter narrows the query to that channel's table, and to that
    // one source within it — the manual table holds both WEB and CSV.
    const channels = channelsFor(source);
    const where: Record<string, unknown> = {};
    if (source) where.source = source;
    if (search) {
      where.OR = [
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { siteName: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { projectSiteId: { contains: search, mode: 'insensitive' } },
        { monitoringStationId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      countReadings(where, channels),
      findReadings({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          referenceNo: true,
          projectSiteId: true,
          monitoringStationId: true,
          oem: true,
          deviceModel: true,
          siteName: true,
          location: true,
          measuredAt: true,
          aqiValue: true,
          pm25: true,
          pm10: true,
          no2: true,
          so2: true,
          co: true,
          ozone: true,
          temperature: true,
          humidity: true,
          otherParams: true,
          source: true,
          integrationMethod: true,
          status: true,
          receivedAt: true,
          user: { select: { name: true, email: true } },
        },
      }, channels),
    ]);

    return ok({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
      rows,
    });
  } catch (error) {
    return handleError(error);
  }
}
