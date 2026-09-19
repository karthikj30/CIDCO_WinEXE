import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/uploads
 *
 * Every Excel workbook architects have delivered over SFTP, newest first. The
 * sheet contents are left out here — fetch one upload for the full preview.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const handshakeId = url.searchParams.get('handshakeId');

    const where: Prisma.SftpUploadWhereInput = {};
    if (status) where.status = status as Prisma.SftpUploadWhereInput['status'];
    if (handshakeId) where.handshakeId = handshakeId;

    const uploads = await prisma.sftpUpload.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        fileName: true,
        sizeBytes: true,
        status: true,
        mode: true,
        sheetName: true,
        rowCount: true,
        importedCount: true,
        failedCount: true,
        sourceIp: true,
        receivedAt: true,
        parsedAt: true,
        // The validation CIDCO ran on this transfer.
        presentedCompanyId: true,
        presentedIp: true,
        presentedPath: true,
        companyIdMatch: true,
        ipMatch: true,
        pathMatch: true,
        validationPassed: true,
        rejectionReason: true,
        handshake: {
          select: {
            id: true,
            clientId: true,
            architect: { select: { id: true, name: true, email: true, firmName: true } },
            company: {
              select: { companyId: true, companyName: true, architectServerIp: true, filePath: true },
            },
          },
        },
      },
    });

    return ok({ uploads });
  } catch (error) {
    return handleError(error);
  }
}
