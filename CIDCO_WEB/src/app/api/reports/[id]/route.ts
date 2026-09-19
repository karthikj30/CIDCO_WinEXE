import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, forbidden, handleError, ok, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    const { id } = await params;

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        attachments: true,
        project: true,
        user: { select: { id: true, name: true, email: true, firmName: true, councilRegNo: true } },
      },
    });
    if (!report) return fail('Report not found', 404);
    if (auth.user.role === 'ARCHITECT' && report.userId !== auth.user.id) return forbidden();

    return ok({
      report: {
        ...report,
        attachments: report.attachments.map((a) => ({ ...a, downloadUrl: `/api/files/${a.id}` })),
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

    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return fail('Report not found', 404);
    if (auth.user.role === 'ARCHITECT' && report.userId !== auth.user.id) return forbidden();
    if (auth.user.role === 'ARCHITECT' && report.status !== 'SUBMITTED') {
      return forbidden('A report can only be withdrawn while it is still in SUBMITTED state');
    }

    await prisma.report.delete({ where: { id } });
    return ok({ message: 'Report deleted', id });
  } catch (error) {
    return handleError(error);
  }
}
