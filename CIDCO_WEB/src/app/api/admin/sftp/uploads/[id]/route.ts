import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import type { SheetColumn } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/uploads/:id
 *
 * The full preview of one delivered workbook: the sheet exactly as the
 * architect sent it, plus what CIDCO made of each row.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const upload = await prisma.sftpUpload.findUnique({
      where: { id },
      include: {
        handshake: {
          select: {
            id: true,
            clientId: true,
            whitelistedIp: true,
            architect: { select: { id: true, name: true, email: true, firmName: true, councilRegNo: true } },
            company: true,
          },
        },
      },
    });
    if (!upload) return fail('Upload not found', 404);

    // Columns carry their label and the reading field behind them, in sheet
    // order, so the preview table lines headers up with cells exactly.
    const columns = (upload.columns as unknown as SheetColumn[] | null) ?? [];
    const rows = (upload.rows as Array<Record<string, unknown>> | null) ?? [];

    return ok({
      upload: {
        id: upload.id,
        fileName: upload.fileName,
        storedName: upload.storedName,
        sizeBytes: upload.sizeBytes,
        status: upload.status,
        sheetName: upload.sheetName,
        columns,
        rows,
        rowCount: upload.rowCount,
        importedCount: upload.importedCount,
        failedCount: upload.failedCount,
        errors: upload.errors ?? [],
        receivedAt: upload.receivedAt,
        parsedAt: upload.parsedAt,
        mode: upload.mode,
        // The validation CIDCO ran: what arrived, what was registered, and
        // which of the three fields matched.
        validation: {
          passed: upload.validationPassed,
          reason: upload.rejectionReason,
          siteName: {
            presented: upload.presentedSiteName,
            expected: upload.handshake.company?.siteName ?? null,
            match: upload.siteNameMatch,
          },
          designatedPath: {
            presented: upload.presentedPath,
            expected: upload.handshake.company?.designatedPath ?? null,
            match: upload.pathMatch,
          },
        },
        handshake: upload.handshake,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
