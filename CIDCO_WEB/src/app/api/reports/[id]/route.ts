import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { fail, forbidden, handleError, ok, unauthorized } from '@/lib/api';
import { findReadingAnywhere, readingDelegate } from '@/lib/readings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    const { id } = await params;

    // The id alone does not say which channel carried the reading, so all
    // three tables are tried.
    const found = await findReadingAnywhere(id, {
      include: {
        attachments: true,
        project: true,
        user: { select: { id: true, name: true, email: true, firmName: true, councilRegNo: true } },
      },
    });
    if (!found) return fail('Report not found', 404);
    const report = found.row;
    if (auth.user.role === 'ARCHITECT' && report.userId !== auth.user.id) return forbidden();

    return ok({
      report: {
        ...report,
        attachments: report.attachments.map((a: { id: string }) => ({ ...a, downloadUrl: `/api/files/${a.id}` })),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    const { id } = await params;

    const found = await findReadingAnywhere(id);
    if (!found) return fail('Report not found', 404);
    const report = found.row;
    if (auth.user.role === 'ARCHITECT' && report.userId !== auth.user.id) return forbidden();
    if (auth.user.role === 'ARCHITECT' && report.status !== 'SUBMITTED') {
      return forbidden('A report can only be withdrawn while it is still in SUBMITTED state');
    }

    await readingDelegate(found.channel).delete({ where: { id } });
    return ok({ message: 'Report deleted', id });
  } catch (error) {
    return handleError(error);
  }
}
