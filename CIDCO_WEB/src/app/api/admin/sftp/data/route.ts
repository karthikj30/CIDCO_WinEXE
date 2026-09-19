import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/data
 *
 * The DATA table, shaped as the folder tree it is stored in:
 * company → month → timestamp → file. `companies` is the MASTER table and
 * each node carries its master row, so an officer can read both together.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const companyId = new URL(req.url).searchParams.get('companyId');

    const [companies, files] = await Promise.all([
      prisma.company.findMany({ orderBy: { companyName: 'asc' } }),
      prisma.dataFile.findMany({
        where: companyId ? { companyId } : {},
        orderBy: { receivedAt: 'desc' },
        take: 1000,
      }),
    ]);

    // Group into company → month → timestamp, newest first at every level.
    type Row = (typeof files)[number];
    const byCompany = new Map<string, Map<string, Map<string, Row[]>>>();
    for (const file of files) {
      const months = byCompany.get(file.companyId) ?? new Map<string, Map<string, Row[]>>();
      const stamps = months.get(file.monthFolder) ?? new Map<string, Row[]>();
      const list = stamps.get(file.timestampFolder) ?? [];
      list.push(file);
      stamps.set(file.timestampFolder, list);
      months.set(file.monthFolder, stamps);
      byCompany.set(file.companyId, months);
    }

    const tree = companies
      .map((company) => {
        const months = byCompany.get(company.companyId) ?? new Map<string, Map<string, Row[]>>();
        return {
          // The master row.
          company: {
            id: company.id,
            companyId: company.companyId,
            companyName: company.companyName,
            architectServerIp: company.architectServerIp,
            filePath: company.filePath,
            publicKey: company.publicKey,
            userId: company.userId,
            contactEmail: company.contactEmail,
            active: company.active,
            createdAt: company.createdAt,
          },
          fileCount: [...months.values()].reduce(
            (n, stamps) => n + [...stamps.values()].reduce((m, list) => m + list.length, 0),
            0,
          ),
          months: [...months.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([monthFolder, stamps]) => ({
              monthFolder,
              timestamps: [...stamps.entries()]
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([timestampFolder, list]) => ({
                  timestampFolder,
                  files: list.map((f: Row) => ({
                    id: f.id,
                    fileName: f.fileName,
                    relativePath: f.relativePath,
                    sizeBytes: f.sizeBytes,
                    rowCount: f.rowCount,
                    importedCount: f.importedCount,
                    sourceIp: f.sourceIp,
                    receivedAt: f.receivedAt,
                    timestamp: f.timestamp,
                    pollStatus: f.pollStatus,
                    fileStatus: f.fileStatus,
                  })),
                })),
            })),
        };
      })
      .sort((a, b) => b.fileCount - a.fileCount);

    return ok({ tree, totalFiles: files.length });
  } catch (error) {
    return handleError(error);
  }
}
