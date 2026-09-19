import { NextRequest } from 'next/server';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { runBothPolls, runPoll1, runPoll2 } from '@/lib/ingestionPoll';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sftp/poll
 *
 * Runs the AQI SFTP Ingestion Service polls:
 *   ?which=1  — poll1 only (inbox → company/month/date/timestamp)
 *   ?which=2  — poll2 only (ingest + archive)
 *   (default) — both
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const which = new URL(req.url).searchParams.get('which');
    if (which === '1') return ok({ poll1: await runPoll1() });
    if (which === '2') return ok({ poll2: await runPoll2() });
    return ok(await runBothPolls());
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
