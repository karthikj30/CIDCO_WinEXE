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
  siteName: z.string().min(2, 'Pick the company to issue credentials for'),
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

    // What each company has actually delivered.
    //
    // The handshake's own sftpUploads only count files that came through
    // CIDCO's intake. An agent uploading to a plain SFTP folder is picked up
    // by the poll worker and never touches it, so an account doing exactly
    // what it should showed "never used" — which is the opposite of the truth
    // and the one thing this page exists to say.
    const companyIds = rows.map((h) => h.company?.siteName).filter(Boolean) as string[];
    const deliveries = companyIds.length
      ? await prisma.dataFile.findMany({
          where: { siteName: { in: companyIds } },
          orderBy: { receivedAt: 'desc' },
          select: {
            siteName: true,
            fileName: true,
            deliveredName: true,
            relativePath: true,
            sizeBytes: true,
            rowCount: true,
            importedCount: true,
            pollStatus: true,
            receivedAt: true,
          },
        })
      : [];

    const byCompany = new Map<string, typeof deliveries>();
    for (const d of deliveries) {
      const list = byCompany.get(d.siteName) ?? [];
      list.push(d);
      byCompany.set(d.siteName, list);
    }

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
              siteName: h.company.siteName,
              designatedPath: h.company.designatedPath,
              email: h.company.email,
              active: h.company.active,
            }
          : null,
        uploadCount: h._count.sftpUploads,
        lastUpload: h.sftpUploads[0] ?? null,
        createdAt: h.createdAt,
        revokedAt: h.revokedAt,
        /** Everything this company has delivered, newest first. */
        deliveries: (byCompany.get(h.company?.siteName ?? '') ?? []).slice(0, 10),
        deliveryCount: (byCompany.get(h.company?.siteName ?? '') ?? []).length,
        lastDelivery: (byCompany.get(h.company?.siteName ?? '') ?? [])[0] ?? null,
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

    const company = await prisma.company.findUnique({ where: { siteName: data.siteName } });
    if (!company) {
      return fail(`No company registered with id "${data.siteName}". Register the company first.`, 404);
    }
    if (!company.active) return fail('That company registration is inactive', 409);

    // SFTP user id = the company id CIDCO registered (e.g. test03).
    const username = company.siteName;
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
        whitelistedIp: '',
        whitelistedAt: new Date(),
      },
    });

    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_CREDENTIALS_ISSUED',
      statusCode: 201,
      detail:
        `SFTP user id issued for ${company.siteName} (${company.siteName})` +
        `${company.email ? `, contact ${company.email}` : ''}; ` +
        `data accepted from ${''} at "${company.designatedPath}"; ` +
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
          email: company.email,
          createdAt: handshake.createdAt,
        },
        // Exactly what the officer sends: the portal login every architect
        // uses, their company's SFTP user id, and where to send.
        portalLogin: { email: SHARED_ARCHITECT_EMAIL, password: SHARED_ARCHITECT_PASSWORD, signInAt: '/' },
        credential: {
          siteName: company.siteName,
          username,
          password: secret,
          designatedIp: endpoint.designatedIp,
          port: endpoint.port,
          protocol: endpoint.protocol,
          designatedPath: company.designatedPath,
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

/**
 * PATCH /api/admin/sftp/accounts
 *
 * Revoke an SFTP account, or grant it back. Revoking is the switch CIDCO
 * needs when an architect's credentials leak or a firm stops being approved —
 * it should not require deleting the account and losing what it delivered.
 */
const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['revoke', 'grant']),
});

export async function PATCH(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const { id, action } = patchSchema.parse(await req.json());
    const account = await prisma.architectHandshake.findUnique({ where: { id }, include: { company: true } });
    if (!account) return fail('No such SFTP account', 404);

    const revoking = action === 'revoke';
    const updated = await prisma.architectHandshake.update({
      where: { id },
      data: revoking
        ? { status: 'REVOKED', revokedAt: new Date() }
        : // Granting it back also clears an expiry that has since passed, or
          // the account would come back already expired and look broken.
          {
            status: 'ESTABLISHED',
            revokedAt: null,
            establishedAt: account.establishedAt ?? new Date(),
            credentialExpiresAt:
              account.credentialExpiresAt.getTime() < Date.now()
                ? addDays(new Date(), 365)
                : account.credentialExpiresAt,
          },
    });

    await logComm({
      handshakeId: id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: revoking ? 'SFTP_ACCOUNT_REVOKED' : 'SFTP_ACCOUNT_GRANTED',
      statusCode: 200,
      detail:
        `${guard.user.email} ${revoking ? 'revoked' : 'granted'} SFTP access for ` +
        `${account.company?.siteName ?? account.clientId}`,
      ip: clientIp(req),
    }).catch(() => undefined);

    return ok({
      message: revoking
        ? `SFTP access revoked for ${account.clientId}. Transfers on it are refused from now on.`
        : `SFTP access granted for ${account.clientId}.`,
      account: { id: updated.id, status: updated.status, revokedAt: updated.revokedAt },
    });
  } catch (error) {
    return handleError(error);
  }
}
