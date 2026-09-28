import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { validateHandshakeSchema } from '@/lib/validation';
import { verifyCredentials } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/architect/handshake-status
 *
 * Lets an architect who has no portal account yet check where their validation
 * stands, using only the CIDCO-issued user id and password. Returns whether
 * they still need to set up their own login.
 */
export async function POST(req: NextRequest) {
  try {
    const { clientId, clientSecret } = validateHandshakeSchema.parse(await req.json());

    const check = await verifyCredentials(clientId, clientSecret);
    if (!check.ok) return fail(`Validation failed: ${check.reason}`, 504);

    const handshake = await prisma.architectHandshake.findUnique({
      where: { id: check.handshake.id },
      include: {
        architect: { select: { email: true, name: true, accountSetupAt: true } },
        validationRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!handshake) return fail('Handshake not found', 404);

    const latest = handshake.validationRequests[0] ?? null;

    return ok({
      clientId: handshake.clientId,
      status: handshake.status,
      approved: handshake.status === 'ESTABLISHED',
      // Once approved the architect sets their own username and password.
      needsAccountSetup: handshake.status === 'ESTABLISHED' && !handshake.architect.accountSetupAt,
      accountEmail: handshake.architect.accountSetupAt ? handshake.architect.email : null,
      latestRequest: latest
        ? {
            status: latest.status,
            presentedIp: latest.presentedIp,
            deviceInfo: latest.deviceInfo,
            reviewNote: latest.reviewNote,
            createdAt: latest.createdAt,
            reviewedAt: latest.reviewedAt,
          }
        : null,
    });
  } catch (error) {
    return handleError(error);
  }
}
