import type { NextRequest } from 'next/server';
import { handleError } from '@/lib/api';
import { buildCsvTemplate, buildTemplateWorkbook } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/sftp/template[?format=xlsx]
 *
 * The blank file an architect fills in and sends. Its header row is the exact
 * set of columns CIDCO parses, so a file built from this always imports. CSV is
 * the default, since that is what the automated feed normally exports.
 */
export async function GET(req: NextRequest) {
  try {
    const format = new URL(req.url).searchParams.get('format');

    if (format === 'xlsx') {
      const buffer = await buildTemplateWorkbook();
      return new Response(new Uint8Array(buffer), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="cidco-aqi-template.xlsx"',
          'cache-control': 'no-store',
        },
      });
    }

    return new Response(buildCsvTemplate(), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="cidco-aqi-template.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
