import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { logAudit } from '@/lib/reports';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** A site from the master table, or null to unlink. */
  siteName: z.string().trim().min(1).nullable(),
});

/**
 * PUT /api/admin/handshakes/:id/site
 *
 * Links an API integration to a registered site. The site is what gives its
 * readings a node, a department and a registered position, so they sit on the
 * dashboard's map and charts beside that site's SFTP deliveries.
 *
 * Readings the integration already posted move with it, so linking late does
 * not leave its history stranded under "not linked".
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;
    const { siteName } = bodySchema.parse(await req.json());

    const handshake = await prisma.architectHandshake.findUnique({ where: { id } });
    if (!handshake || handshake.channel !== 'API') return fail('API handshake not found', 404);

    const company = siteName ? await prisma.company.findUnique({ where: { siteName } }) : null;
    if (siteName && !company) return fail(`No site "${siteName}" in the master table`, 404);

    const [, moved] = await prisma.$transaction([
      prisma.architectHandshake.update({ where: { id }, data: { companyRecordId: company?.id ?? null } }),
      prisma.apiReading.updateMany({ where: { handshakeId: id }, data: { companyRecordId: company?.id ?? null } }),
    ]);

    await logAudit('handshake.site', {
      userId: guard.user.id,
      detail: `${handshake.clientId} -> ${company?.siteName ?? 'no site'} (${moved.count} readings)`,
    });

    return ok({
      message: company
        ? `Linked to ${company.siteName}; ${moved.count} reading(s) now show under that site.`
        : `Unlinked; ${moved.count} reading(s) now show as not linked to a site.`,
      site: company ? { id: company.id, siteName: company.siteName } : null,
      readingsMoved: moved.count,
    });
  } catch (error) {
    return handleError(error);
  }
}
