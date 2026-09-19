import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, forbidden, handleError, ok, unauthorized } from '@/lib/api';
import { logAudit } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** DELETE /api/api-keys/:id — revoke a key without losing its audit trail. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    const { id } = await params;

    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) return fail('API key not found', 404);
    if (key.userId !== auth.user.id) return forbidden();

    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await logAudit('apikey.revoke', { userId: auth.user.id, detail: key.label });

    return ok({ message: 'API key revoked', id });
  } catch (error) {
    return handleError(error);
  }
}
