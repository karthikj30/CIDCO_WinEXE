import type { NextRequest } from 'next/server';
import Papa from 'papaparse';
import { authenticate } from '@/lib/auth';
import { fail, handleError, ok, unauthorized } from '@/lib/api';
import { reportSchema } from '@/lib/validation';
import { createReport, logAudit } from '@/lib/reports';
import { ALLOWED_CSV_TYPES, assertFileAllowed, saveUpload } from '@/lib/storage';
import { CSV_TEMPLATE, normaliseHeader } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reports/csv
 *
 * Channel 2 — the architect uploads a CSV of readings. Rows are validated
 * individually so one bad row does not sink the whole file; the response
 * reports exactly which rows failed and why.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return fail('Send the CSV as multipart/form-data under the field name "file"', 415);
    }

    const form = await req.formData();
    const file = (form.get('file') ?? form.get('csv') ?? form.get('csvFile')) as File | null;
    if (!file || typeof file === 'string') {
      return fail('No CSV file found. Use form-data field name "file".', 422);
    }
    assertFileAllowed(file, ALLOWED_CSV_TYPES, 'CSV file');

    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normaliseHeader,
    });

    if (!parsed.data.length) {
      return fail('The CSV file contains no data rows', 422);
    }

    // The CSV itself is archived once and linked to every report it produced.
    const storedCsv = await saveUpload(file);

    const created: Array<{ row: number; id: string; referenceNo: string; siteName: string; aqiValue: number }> = [];
    const errors: Array<{ row: number; message: string; details?: unknown }> = [];

    for (let i = 0; i < parsed.data.length; i++) {
      const rowNumber = i + 2; // +1 for header, +1 for 1-based numbering
      try {
        const input = reportSchema.parse(parsed.data[i]);
        const report = await createReport({
          userId: auth.user.id,
          source: 'CSV',
          input,
          preStored: [{ ...storedCsv, kind: 'CSV_SOURCE' }],
        });
        created.push({
          row: rowNumber,
          id: report.id,
          referenceNo: report.referenceNo,
          siteName: report.siteName,
          aqiValue: report.aqiValue,
        });
      } catch (error) {
        const details =
          error && typeof error === 'object' && 'flatten' in error
            ? (error as { flatten: () => { fieldErrors: unknown } }).flatten().fieldErrors
            : undefined;
        errors.push({
          row: rowNumber,
          message: details ? 'Validation failed' : (error as Error).message,
          details,
        });
      }
    }

    await logAudit('report.csv_upload', {
      userId: auth.user.id,
      detail: `${file.name}: ${created.length} created, ${errors.length} failed`,
    });

    return ok(
      {
        message: `Processed ${parsed.data.length} row(s)`,
        fileName: file.name,
        totalRows: parsed.data.length,
        createdCount: created.length,
        failedCount: errors.length,
        created,
        errors,
      },
      created.length ? 201 : 422,
    );
  } catch (error) {
    if (error instanceof Error && /exceeds|unsupported type|is empty/.test(error.message)) {
      return fail(error.message, 422);
    }
    return handleError(error);
  }
}

/** GET /api/reports/csv — returns the expected header row as a template. */
export async function GET() {
  return new Response(CSV_TEMPLATE, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cidco-aqi-template.csv"',
    },
  });
}
