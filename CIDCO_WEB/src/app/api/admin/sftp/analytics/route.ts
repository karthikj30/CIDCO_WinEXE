import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { AQI_PARAMETERS, readingsOf } from '@/lib/aqiRows';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/analytics?companyId=ABCD123
 *
 * What one company's deliveries look like, for the charts: the headline
 * numbers, deliveries per day, and the AQI the readings actually carried.
 *
 * It reads `aqiData` on each filed CSV rather than the stored readings, for
 * the same reason the readings table does: rows CIDCO rejected are in there
 * too, and a chart drawn only from what was stored would quietly flatter the
 * data by leaving out everything that failed.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const companyId = url.searchParams.get('companyId');
    if (!companyId) return ok({ companyId: null, series: [], deliveries: [], totals: null, log: [] });

    const files = await prisma.dataFile.findMany({
      where: { companyId },
      orderBy: { receivedAt: 'desc' },
      take: 300,
    });

    // --- the log ----------------------------------------------------------
    const log = files.map((f) => ({
      id: f.id,
      deliveredName: f.deliveredName,
      fileName: f.fileName,
      dateFolder: f.dateFolder,
      relativePath: f.relativePath,
      sizeBytes: f.sizeBytes,
      rowCount: f.rowCount,
      importedCount: f.importedCount,
      rejectedCount: Math.max(0, f.rowCount - f.importedCount),
      pollStatus: f.pollStatus,
      headline: (f.fileStatus ?? '').split('\n')[0] || null,
      failedStep: (f.fileStatus ?? '').split('\n').find((l) => l.includes('FAILED')) ?? null,
      sourceIp: f.sourceIp,
      receivedAt: f.receivedAt,
    }));

    // --- deliveries per day ------------------------------------------------
    // Keyed by the day folder, which is the day the reading was sent.
    const perDay = new Map<string, { files: number; stored: number; rejected: number }>();
    for (const f of files) {
      const key = f.dateFolder;
      const row = perDay.get(key) ?? { files: 0, stored: 0, rejected: 0 };
      row.files += 1;
      row.stored += f.importedCount;
      row.rejected += Math.max(0, f.rowCount - f.importedCount);
      perDay.set(key, row);
    }
    // dd_mm_yyyy does not sort as text, so sort on what it means.
    const asDate = (d: string) => {
      const [dd, mm, yyyy] = d.split('_');
      return `${yyyy}-${mm}-${dd}`;
    };
    const deliveries = [...perDay.entries()]
      .filter(([d]) => /^\d{2}_\d{2}_\d{4}$/.test(d))
      .sort((a, b) => asDate(a[0]).localeCompare(asDate(b[0])))
      .map(([dateFolder, v]) => ({ dateFolder, ...v }));

    // --- the AQI itself ----------------------------------------------------
    const points: Array<{ at: string; aqi: number; station: string | null }> = [];
    for (const file of files) {
      for (const reading of readingsOf(file)) {
        const rawAqi = reading.values.aqiValue;
        const rawAt = reading.values.measuredAt;
        if (rawAqi === null || rawAt === null) continue;
        const aqi = Number(rawAqi);
        const at = Date.parse(rawAt);
        if (!Number.isFinite(aqi) || Number.isNaN(at)) continue;
        points.push({
          at: new Date(at).toISOString(),
          aqi,
          station: reading.values.monitoringStationId,
        });
      }
    }
    points.sort((a, b) => a.at.localeCompare(b.at));

    const aqis = points.map((p) => p.aqi);
    const totals = {
      files: files.length,
      archived: files.filter((f) => f.pollStatus === 'ARCHIVED').length,
      failed: files.filter((f) => f.pollStatus === 'FAILED').length,
      rows: files.reduce((n, f) => n + f.rowCount, 0),
      stored: files.reduce((n, f) => n + f.importedCount, 0),
      rejected: files.reduce((n, f) => n + Math.max(0, f.rowCount - f.importedCount), 0),
      readings: points.length,
      aqiAverage: aqis.length ? Math.round(aqis.reduce((a, b) => a + b, 0) / aqis.length) : null,
      aqiPeak: aqis.length ? Math.max(...aqis) : null,
      lastDeliveryAt: files[0]?.receivedAt ?? null,
    };

    return ok({
      companyId,
      totals,
      deliveries,
      // A line with thousands of points is a smear; this keeps the shape.
      series: points.length > 400 ? points.filter((_, i) => i % Math.ceil(points.length / 400) === 0) : points,
      log,
      parameters: AQI_PARAMETERS,
    });
  } catch (error) {
    return handleError(error);
  }
}
