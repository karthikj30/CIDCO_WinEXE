import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireArchitect } from '@/lib/guards';
import { sftpEndpoint } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/sftp/me
 *
 * Everything the architect's SFTP workspace needs: the company CIDCO
 * registered for them, where to send, and CIDCO's validation result for every
 * transfer they have made.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireArchitect(req);
    if ('error' in guard) return guard.error;
    const me = guard.user;
    const now = Date.now();

    const accounts = await prisma.architectHandshake.findMany({
      where: { architectId: me.id, channel: 'SFTP' },
      orderBy: { createdAt: 'desc' },
      include: {
        company: true,
        commLogs: { orderBy: { createdAt: 'desc' }, take: 30 },
        sftpUploads: {
          orderBy: { receivedAt: 'desc' },
          take: 25,
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
            errors: true,
            receivedAt: true,
            parsedAt: true,
            presentedSiteName: true,
            presentedPath: true,
            siteNameMatch: true,
            pathMatch: true,
            validationPassed: true,
            rejectionReason: true,
          },
        },
      },
    });

    return ok({
      architect: { id: me.id, name: me.name, email: me.email, firmName: me.firmName },
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
      accounts: accounts.map((a) => ({
        id: a.id,
        username: a.clientId,
        status: a.credentialExpiresAt.getTime() < now && a.status !== 'REVOKED' ? 'EXPIRED' : a.status,
        credentialExpiresAt: a.credentialExpiresAt,
        establishedAt: a.establishedAt,
        // What CIDCO registered — and therefore what each transfer must match.
        company: a.company
          ? {
              siteName: a.company.siteName,
              designatedPath: a.company.designatedPath,
              active: a.company.active,
            }
          : null,
        uploads: a.sftpUploads,
        commLogs: a.commLogs,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
