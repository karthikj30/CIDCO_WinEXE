import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireArchitect } from '@/lib/guards';
import { hashesEqual, sftpEndpoint, sha256 } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

const schema = z.object({
  username: z.string().min(3, 'Enter the SFTP user id CIDCO sent you'),
  password: z.string().min(1, 'Enter the SFTP password CIDCO sent you'),
});

/**
 * POST /api/architect/sftp/connect
 *
 * Architects share one portal login, so the session alone cannot say which
 * company someone is. They connect the way they would in WinSCP — with the
 * SFTP user id and password CIDCO issued for their company — and that pair is
 * what identifies them here.
 *
 * Returns the registration every transfer is validated against, and the
 * transfers made on that account so far.
 */
export async function POST(req: NextRequest) {
  try {
    // The portal login is still required: this is not a public endpoint.
    const guard = await requireArchitect(req);
    if ('error' in guard) return guard.error;

    const { username, password } = schema.parse(await req.json());

    const handshake = await prisma.architectHandshake.findUnique({
      where: { clientId: username.trim() },
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

    if (!handshake || handshake.channel !== 'SFTP' || !hashesEqual(sha256(password), handshake.secretHash)) {
      return fail('That user id and password did not match. Check the credentials CIDCO emailed you.', 401);
    }
    if (handshake.revokedAt || handshake.status === 'REVOKED') {
      return fail('These credentials have been revoked. Ask CIDCO to issue new ones.', 403);
    }
    if (handshake.credentialExpiresAt.getTime() < Date.now()) {
      return fail('These credentials have expired. Ask CIDCO to issue new ones.', 403);
    }
    if (!handshake.company) {
      return fail('These credentials are not linked to a registered company. Ask CIDCO to check the registration.', 409);
    }
    if (!handshake.company.active) {
      return fail(`The registration for ${handshake.company.siteName} is inactive.`, 403);
    }

    return ok({
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
      account: {
        id: handshake.id,
        username: handshake.clientId,
        status: handshake.status,
        credentialExpiresAt: handshake.credentialExpiresAt,
        establishedAt: handshake.establishedAt,
        company: {
          siteName: handshake.company.siteName,
          designatedPath: handshake.company.designatedPath,
          email: handshake.company.email,
          active: handshake.company.active,
        },
        uploads: handshake.sftpUploads,
        commLogs: handshake.commLogs,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
