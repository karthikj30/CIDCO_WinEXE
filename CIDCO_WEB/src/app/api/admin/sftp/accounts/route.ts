import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { addDays, clientIp, logComm } from '@/lib/handshake';
import { sftpEndpoint, sha256 } from '@/lib/sftp';
import { SHARED_ARCHITECT_EMAIL, SHARED_ARCHITECT_PASSWORD, sharedArchitectAccount } from '@/lib/portalAccount';

export const dynamic = 'force-dynamic';

const issueSchema = z.object({
  /** The registered company these credentials belong to. */
  companyId: z.string().min(2, 'Pick the company to issue credentials for'),
  expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
});

/** Same password as the shared portal login (cidco@gmail.com). */
function sftpPasswordBundle() {
  const secret = SHARED_ARCHITECT_PASSWORD;
  return { secret, secretHash: sha256(secret), secretPrefix: secret.slice(0, 8) };
}

/** GET /api/admin/sftp/accounts — every SFTP account and what it has delivered. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const rows = await prisma.architectHandshake.findMany({
      where: { channel: 'SFTP' },
      orderBy: { createdAt: 'desc' },
      include: {
        company: true,
        _count: { select: { sftpUploads: true } },
        sftpUploads: {
          orderBy: { receivedAt: 'desc' },
          take: 1,
          select: { receivedAt: true, status: true, validationPassed: true },
        },
      },
    });

    const now = Date.now();
    return ok({
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
      accounts: rows.map((h) => ({
        id: h.id,
        username: h.clientId,
        passwordPrefix: h.secretPrefix,
        status: h.credentialExpiresAt.getTime() < now && h.status !== 'REVOKED' ? 'EXPIRED' : h.status,
        credentialExpiresAt: h.credentialExpiresAt,
        establishedAt: h.establishedAt,
        // The registration every transfer on this account is checked against.
        company: h.company
          ? {
              id: h.company.id,
              companyId: h.company.companyId,
              companyName: h.company.companyName,
              architectServerIp: h.company.architectServerIp,
              filePath: h.company.filePath,
              contactEmail: h.company.contactEmail,
              active: h.company.active,
            }
          : null,
        uploadCount: h._count.sftpUploads,
        lastUpload: h.sftpUploads[0] ?? null,
        createdAt: h.createdAt,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/admin/sftp/accounts
 *
 * Step two: issue an SFTP user id and password against a company CIDCO has
 * already registered. The password matches the shared portal login; the user
 * id is unique per company and is what the officer emails over, with the
 * designated IP to send to.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const data = issueSchema.parse(await req.json());

    const company = await prisma.company.findUnique({ where: { companyId: data.companyId } });
    if (!company) {
      return fail(`No company registered with id "${data.companyId}". Register the company first.`, 404);
    }
    if (!company.active) return fail('That company registration is inactive', 409);

    // SFTP user id = the company id CIDCO registered (e.g. test03).
    const username = company.companyId;
    const taken = await prisma.architectHandshake.findUnique({ where: { clientId: username } });
    if (taken) {
      return fail(
        `SFTP credentials already exist for company id "${username}". Revoke the old account first if you need to re-issue.`,
        409,
      );
    }

    // Handshakes hang off the shared portal login — architects have no account
    // of their own; this user id and password are their company's identity.
    const owner = company.architectId
      ? await prisma.user.findUnique({ where: { id: company.architectId } })
      : await sharedArchitectAccount();
    if (!owner) return fail('Could not resolve the portal account for this company', 500);

    const credentialExpiresAt = addDays(new Date(), data.expiresInDays ?? 365);

    const { secret, secretHash, secretPrefix } = sftpPasswordBundle();

    const handshake = await prisma.architectHandshake.create({
      data: {
        architectId: owner.id,
        channel: 'SFTP',
        companyRecordId: company.id,
        clientId: username,
        secretHash,
        secretPrefix,
        credentialExpiresAt,
        createdById: guard.user.id,
        // The company registration is CIDCO's manual approval, so the channel
        // is open from here — every transfer is still validated individually.
        status: 'ESTABLISHED',
        establishedAt: new Date(),
        whitelistedIp: company.architectServerIp,
        whitelistedAt: new Date(),
      },
    });

    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_CREDENTIALS_ISSUED',
      statusCode: 201,
      detail:
        `SFTP user id issued for ${company.companyName} (${company.companyId})` +
        `${company.contactEmail ? `, contact ${company.contactEmail}` : ''}; ` +
        `data accepted from ${company.architectServerIp} at "${company.filePath}"; ` +
        `valid until ${credentialExpiresAt.toISOString()}`,
      ip: clientIp(req),
    });

    const endpoint = sftpEndpoint(req.headers.get('host')?.split(':')[0]);

    return ok(
      {
        message:
          'SFTP credentials issued. The user id is this company\'s registered id; the password matches the shared portal login.',
        account: {
          id: handshake.id,
          status: handshake.status,
          contactEmail: company.contactEmail,
          createdAt: handshake.createdAt,
        },
        // Exactly what the officer sends: the portal login every architect
        // uses, their company's SFTP user id, and where to send.
        portalLogin: { email: SHARED_ARCHITECT_EMAIL, password: SHARED_ARCHITECT_PASSWORD, signInAt: '/' },
        credential: {
          companyName: company.companyName,
          companyId: company.companyId,
          username,
          password: secret,
          designatedIp: endpoint.designatedIp,
          port: endpoint.port,
          protocol: endpoint.protocol,
          filePath: company.filePath,
          fileTypes: endpoint.fileTypes,
          expiryDate: credentialExpiresAt.toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
