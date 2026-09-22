import type { NextRequest } from 'next/server';
import type { ArchitectHandshake, Company } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { clientIp } from '@/lib/handshake';
import {
  hashesEqual,
  isAcceptedFile,
  isSharedSftpLogin,
  normalisePath,
  sftpEndpoint,
  sha256,
  sharedLoginHandshake,
} from '@/lib/sftp';
import { enqueueInboxFile, parseAqiFileName } from '@/lib/ingestionPoll';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/architect/sftp/transfer
 *
 * Queues the CSV into the inbox. Poll1 files it under
 * company/month/date/timestamp; poll2 runs the 10-step ingestion.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return fail('Send multipart/form-data with the file and your connection details', 415);

    const username = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const designatedIp = String(form.get('designatedIp') ?? '').trim();
    const declaredPath = String(form.get('filePath') ?? '').trim();
    const declaredCompanyId = String(form.get('companyId') ?? '').trim();
    const file = form.get('file');

    if (!username || !password) return fail('Enter the user id and password CIDCO sent you', 422);
    if (!(file instanceof File)) return fail('Attach the file to send', 422);
    if (!isAcceptedFile(file.name)) return fail('Only .csv and .xlsx files are accepted', 422);
    if (file.size === 0) return fail('That file is empty', 422);
    if (file.size > MAX_BYTES) return fail('That file is larger than 25 MB', 422);

    let handshake: (ArchitectHandshake & { company: Company | null }) | null = null;

    if (isSharedSftpLogin(username, password)) {
      const carrier = await sharedLoginHandshake();
      if (!carrier) {
        return fail('The shared CIDCO login is not configured on this server', 503);
      }

      const fromName = parseAqiFileName(file.name)?.companyId;
      const companyId = declaredCompanyId || fromName;
      if (!companyId) {
        return fail('Send your company id alongside the file when using the shared CIDCO login', 422);
      }

      const named = await prisma.company.findUnique({ where: { companyId } });
      // Missing registration is fine — poll1 will auto-create from the filename.
      handshake = { ...carrier, company: named };
    } else {
      handshake = await prisma.architectHandshake.findUnique({
        where: { clientId: username },
        include: { company: true },
      });
      if (!handshake || handshake.channel !== 'SFTP' || !hashesEqual(sha256(password), handshake.secretHash)) {
        return fail('That user id and password did not match. Check the credentials CIDCO emailed you.', 401);
      }
      if (handshake.revokedAt || handshake.status === 'REVOKED') {
        return fail('These credentials have been revoked', 403);
      }
      if (handshake.credentialExpiresAt.getTime() < Date.now()) {
        return fail('These credentials have expired — ask CIDCO to issue new ones', 403);
      }
    }

    const endpoint = sftpEndpoint(req.headers.get('host')?.split(':')[0]);
    if (designatedIp && (designatedIp) !== (endpoint.designatedIp)) {
      return fail(
        `${designatedIp} is not CIDCO's designated address for this channel. Use ${endpoint.designatedIp}.`,
        422,
      );
    }

    const company = handshake.company;
    const presentedPath = normalisePath(declaredPath || company?.filePath || '');
    const buffer = Buffer.from(await file.arrayBuffer());

    const queued = await enqueueInboxFile({
      fileName: file.name,
      buffer,
      presentedPath,
      mode: 'PORTAL',
      company,
      handshakeId: handshake.id,
    });

    return ok(
      {
        message:
          `${file.name} queued for poll1/poll2 as ${queued.inboxName}. ` +
          'Poll1 will create company/month/date/timestamp; poll2 will ingest and archive.',
        upload: {
          id: queued.upload.id,
          fileName: queued.inboxName,
          status: queued.upload.status,
          receivedAt: queued.upload.receivedAt,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
