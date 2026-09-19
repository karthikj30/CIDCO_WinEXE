import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, forbidden, handleError, ok, unauthorized } from '@/lib/api';
import { reviewSchema } from '@/lib/validation';
import { logAudit } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** PATCH /api/reports/:id/review — CIDCO officers move a report through its workflow. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    if (auth.user.role === 'ARCHITECT') {
      return forbidden('Only CIDCO officers can review reports');
    }

    const { id } = await params;
    const { status, reviewNote } = reviewSchema.parse(await req.json());

    const existing = await prisma.report.findUnique({ where: { id } });
    if (!existing) return fail('Report not found', 404);

    const report = await prisma.report.update({
      where: { id },
      data: {
        status,
        reviewNote: reviewNote ?? null,
        reviewedBy: auth.user.name,
        reviewedAt: new Date(),
      },
    });

    await logAudit('report.review', { userId: auth.user.id, detail: `${report.referenceNo} -> ${status}` });
    return ok({ message: `Report marked ${status}`, report });
  } catch (error) {
    return handleError(error);
  }
}
