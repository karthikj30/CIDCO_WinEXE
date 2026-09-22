import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { AQI_PARAMETERS, readingsOf } from '@/lib/aqiRows';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/data/rows?siteName=ABCD123
 *
 * Every AQI reading CIDCO holds for a company, flattened out of the files it
 * arrived in, one row per reading — with the parameters that reading is
 * missing named on it.
 *
 * The file tree answers "what was delivered". This answers "what is actually
 * in it", which is the question a blank cell makes you ask.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const siteName = url.searchParams.get('siteName');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 500) || 500, 2000);

    const files = await prisma.dataFile.findMany({
      where: siteName ? { siteName } : {},
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });

    const rows = files.flatMap(readingsOf).slice(0, limit);

    // How often each parameter is missing across everything shown, so a
    // station that has never reported ozone stands out from one that dropped
    // a single reading.
    const gaps = AQI_PARAMETERS.map((p) => ({
      key: p.key,
      label: p.label,
      missing: rows.filter((r) => r.missing.includes(p.key)).length,
    })).filter((g) => g.missing > 0);

    return ok({
      parameters: AQI_PARAMETERS,
      rows,
      gaps,
      total: rows.length,
      complete: rows.filter((r) => r.missing.length === 0).length,
    });
  } catch (error) {
    return handleError(error);
  }
}
