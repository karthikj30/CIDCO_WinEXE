/**
 * CIDCO's SFTP intake server.
 *
 * This is the SFTP half of the portal, and it is deliberately separate from the
 * API half: different credentials, different dashboard, different transport.
 *
 *   1. A CIDCO officer registers the company by hand first — company name,
 *      company id, the architect's server address, and the file path their CSV
 *      is taken from.
 *   2. CIDCO issues an SFTP user id and password against that record and emails
 *      it, along with the designated address to send to.
 *   3. The architect sends automatically, taking the CSV from the registered
 *      path and writing it to the same path here.
 *   4. EVERY transfer is validated against the company record: company id, the
 *      address it arrived from, and the path it was written to. Only when all
 *      three match is the file parsed and its readings stored.
 *
 * Run it with:  npm run sftp
 */
import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { generateKeyPairSync, randomUUID } from 'crypto';
import { Server, utils } from 'ssh2';
import type { Connection, FileEntry } from 'ssh2';
import type { ArchitectHandshake, Company } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  hashesEqual,
  homeDirFor,
  isAcceptedFile,
  isSharedSftpLogin,
  normalisePath,
  parseAgentPath,
  SFTP_PORT,
  sha256,
  SHARED_SFTP_USER,
  sharedLoginHandshake,
  storageRoot,
} from '../src/lib/sftp';
import { enqueueInboxFile, parseAqiFileName } from '../src/lib/ingestionPoll';

const { STATUS_CODE, OPEN_MODE } = utils.sftp;

const HOST = process.env.SFTP_HOST || '0.0.0.0';

/**
 * An authenticated session.
 *
 * Per-company credentials carry their company. The shared CIDCO login the
 * Windows agent uses does not — it names the company in the upload path
 * instead, and `shared` marks that.
 */
type Account = { handshake: ArchitectHandshake; company: Company | null; shared: boolean };

/** Where this account is expected to write — the registered file path. */
function expectedDir(account: Account) {
  return normalisePath(account.company?.filePath) || '/upload';
}

function log(...parts: unknown[]) {
  console.log(`[sftp ${new Date().toISOString()}]`, ...parts);
}

/** Writes a CommunicationLog row; never throws into the SSH layer. */
async function logComm(entry: {
  handshakeId: string | null;
  direction: 'ADMIN_TO_ARCHITECT' | 'ARCHITECT_TO_ADMIN';
  event: string;
  statusCode?: number;
  detail?: string;
  ip?: string | null;
}) {
  try {
    await prisma.communicationLog.create({
      data: {
        handshakeId: entry.handshakeId,
        direction: entry.direction,
        event: entry.event,
        statusCode: entry.statusCode ?? null,
        detail: entry.detail ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch (error) {
    log('could not write comm log:', error);
  }
}

/**
 * The server's SSH host key. Generated once and kept on disk so an architect's
 * client does not warn about a changed key on every restart.
 */
async function hostKey(): Promise<string> {
  const file = path.join(storageRoot(), 'ssh_host_rsa_key');
  await fs.mkdir(storageRoot(), { recursive: true });
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    log('generating a new SSH host key…');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await fs.writeFile(file, privateKey, { mode: 0o600 });
    return privateKey;
  }
}

type AuthOutcome =
  | { ok: true; account: Account }
  | { ok: false; reason: string; handshakeId: string | null; event: string };

/**
 * Run on every connection. The credentials must verify and must belong to a
 * company CIDCO registered beforehand — that registration is the manual gate,
 * so there is no separate per-connection approval step.
 *
 * The address is checked here as an early refusal, and checked again against
 * the company record on each transfer.
 */
async function authorise(username: string, password: string, ip: string | null, client: string): Promise<AuthOutcome> {
  // The Windows agent signs in with one CIDCO username and password and names
  // its company in the upload path. Every file is still validated in full.
  if (isSharedSftpLogin(username, password)) {
    const carrier = await sharedLoginHandshake();
    if (!carrier) {
      return {
        ok: false,
        reason: 'The shared CIDCO SFTP login is not configured on this server',
        handshakeId: null,
        event: 'SFTP_AUTH_FAILED',
      };
    }
    return { ok: true, account: { handshake: carrier, company: null, shared: true } };
  }

  const handshake = await prisma.architectHandshake.findUnique({
    where: { clientId: username },
    include: { company: true },
  });

  if (!handshake || handshake.channel !== 'SFTP') {
    return { ok: false, reason: `Unknown SFTP user id "${username}"`, handshakeId: null, event: 'SFTP_AUTH_FAILED' };
  }
  if (!hashesEqual(sha256(password), handshake.secretHash)) {
    return { ok: false, reason: 'Incorrect SFTP password', handshakeId: handshake.id, event: 'SFTP_AUTH_FAILED' };
  }
  if (handshake.revokedAt || handshake.status === 'REVOKED') {
    return { ok: false, reason: 'These SFTP credentials have been revoked', handshakeId: handshake.id, event: 'SFTP_AUTH_FAILED' };
  }
  if (handshake.credentialExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'These SFTP credentials have expired', handshakeId: handshake.id, event: 'SFTP_AUTH_FAILED' };
  }

  const company = handshake.company;
  if (!company) {
    return {
      ok: false,
      reason: 'These credentials are not linked to a registered company',
      handshakeId: handshake.id,
      event: 'SFTP_AUTH_FAILED',
    };
  }
  if (!company.active) {
    return {
      ok: false,
      reason: `The registration for ${company.companyName} (${company.companyId}) is inactive`,
      handshakeId: handshake.id,
      event: 'SFTP_AUTH_FAILED',
    };
  }

  // The registered server address is the only one data may arrive from.
  if ((company.architectServerIp) !== (ip)) {
    return {
      ok: false,
      reason:
        `${company.companyId} is registered to ${company.architectServerIp}; ` +
        `refusing a connection from ${ip ?? 'unknown'}`,
      handshakeId: handshake.id,
      event: 'SFTP_IP_REFUSED',
    };
  }

  // Keep the channel record current so the dashboards read correctly.
  await prisma.architectHandshake.update({
    where: { id: handshake.id },
    data: {
      status: 'ESTABLISHED',
      establishedAt: handshake.establishedAt ?? new Date(),
      whitelistedIp: company.architectServerIp,
      whitelistedAt: handshake.whitelistedAt ?? new Date(),
      deviceInfo: client,
      lastValidatedIp: ip,
    },
  });

  return { ok: true, account: { handshake, company, shared: false } };
}

// --- SFTP session ----------------------------------------------------------

/** An in-flight upload. Chunks are buffered and written out when the handle closes. */
type WriteHandle = {
  kind: 'file';
  fileName: string;
  /** The directory the client wrote to — validated against the company record. */
  dir: string;
  /** Named in the path by the shared login; absent for per-company credentials. */
  companyId?: string;
  /** The remote path exactly as the client asked for it, for the stat after a put. */
  remote: string;
  chunks: Buffer[];
  bytes: number;
};
type DirHandle = { kind: 'dir'; entries: FileEntry[]; sent: boolean };
type Handle = WriteHandle | DirHandle;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Files are ingested, not left lying at the path they were written to — but
 * ordinary clients (WinSCP, paramiko, the sftp CLI) stat the file straight
 * after a put to confirm the size. Remember what just arrived so that check
 * sees the truth instead of "no such file".
 */
const justReceived = new Map<string, { size: number; at: number }>();

function rememberReceived(remotePath: string, size: number) {
  justReceived.set(normalisePath(remotePath), { size, at: Date.now() });
  // Keep the map small: anything older than ten minutes is of no use.
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, value] of justReceived) {
    if (value.at < cutoff) justReceived.delete(key);
  }
}

function attrsFor(size: number, isDir: boolean) {
  const now = Math.floor(Date.now() / 1000);
  return {
    mode: isDir ? fsConstants.S_IFDIR | 0o755 : fsConstants.S_IFREG | 0o644,
    uid: 0,
    gid: 0,
    size,
    atime: now,
    mtime: now,
  };
}

function startSession(conn: Connection, account: Account, ip: string | null) {
  const { handshake } = account;
  // The directory this account is expected to write to: the file path CIDCO
  // registered for the company. The path a client actually writes to is what
  // gets validated on every transfer.
  // The shared login has no single registered path: it names a company per
  // upload, so its working directory is the root.
  const home = account.shared ? '/' : expectedDir(account);

  conn.on('session', (acceptSession) => {
    const session = acceptSession();

    session.on('sftp', (acceptSftp) => {
      const sftp = acceptSftp();
      log(`sftp session opened for ${handshake.clientId} from ${ip} (home ${home})`);

      const handles = new Map<number, Handle>();
      let nextHandle = 0;
      const newHandle = (value: Handle) => {
        const id = nextHandle++;
        handles.set(id, value);
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(id, 0);
        return buf;
      };
      const readHandle = (buf: Buffer) => handles.get(buf.readUInt32BE(0));

      // A bare "." or "/" lands the client in the registered file path, so a
      // plain `put readings.csv` writes exactly where CIDCO expects it.
      sftp.on('REALPATH', (reqid, givenPath) => {
        const resolved =
          givenPath === '.' || givenPath === '' || givenPath === '/' ? home : path.posix.normalize(givenPath);
        sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: attrsFor(0, true) } as FileEntry]);
      });

      // Directories are virtual: any path stats as a directory so clients can
      // navigate to the registered path, wherever it is.
      const statLike = (reqid: number, givenPath: string) => {
        const clean = normalisePath(givenPath) || '/';
        if (isAcceptedFile(clean)) {
          const seen = justReceived.get(clean);
          if (seen) return sftp.attrs(reqid, attrsFor(seen.size, false));
          return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }
        return sftp.attrs(reqid, attrsFor(0, true));
      };
      sftp.on('STAT', statLike);
      sftp.on('LSTAT', statLike);

      sftp.on('FSTAT', (reqid, handleBuf) => {
        const handle = readHandle(handleBuf);
        if (!handle) return sftp.status(reqid, STATUS_CODE.FAILURE);
        return sftp.attrs(reqid, attrsFor(handle.kind === 'file' ? handle.bytes : 0, handle.kind === 'dir'));
      });

      // Clients set permissions/timestamps after a put; accept and ignore.
      sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
      sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
      sftp.on('MKDIR', (reqid) => sftp.status(reqid, STATUS_CODE.OK));

      sftp.on('OPENDIR', async (reqid, _givenPath) => {
        // List what this company has already delivered.
        const uploads = await prisma.sftpUpload
          .findMany({ where: { handshakeId: handshake.id }, orderBy: { receivedAt: 'desc' }, take: 100 })
          .catch(() => []);
        const entries: FileEntry[] = uploads.map((u) => ({
          filename: u.storedName,
          longname: `-rw-r--r-- 1 cidco cidco ${String(u.sizeBytes).padStart(9)} ${u.receivedAt.toISOString().slice(0, 16)} ${u.storedName}`,
          attrs: attrsFor(u.sizeBytes, false),
        })) as FileEntry[];
        sftp.handle(reqid, newHandle({ kind: 'dir', entries, sent: false }));
      });

      sftp.on('READDIR', (reqid, handleBuf) => {
        const handle = readHandle(handleBuf);
        if (!handle || handle.kind !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE);
        if (handle.sent) return sftp.status(reqid, STATUS_CODE.EOF);
        handle.sent = true;
        return sftp.name(reqid, handle.entries);
      });

      sftp.on('OPEN', (reqid, filename, flags) => {
        // Read-back is not offered: this is a one-way intake channel.
        if (!(flags & OPEN_MODE.WRITE)) {
          return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }
        const base = path.posix.basename(filename);
        if (!isAcceptedFile(base)) {
          log(`refused ${base} from ${handshake.clientId}: not a .csv or .xlsx file`);
          return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }

        if (account.shared) {
          // The agent names its company first: /<companyId>/<source path>/<file>
          const parsed = parseAgentPath(filename);
          if (!parsed) {
            log(`refused ${base}: the shared login must write to /<companyId>/<path>/<file>`);
            return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
          }
          // An unregistered company is refused here and now, so the agent gets
          // a real error rather than a silent rejection after the fact. A
          // registered company with the wrong address or path still goes
          // through, so CIDCO records the refusal and why.
          void (async () => {
            const known = await prisma.company
              .findUnique({ where: { companyId: parsed.companyId } })
              .catch(() => null);
            if (!known || !known.active) {
              log(`refused ${base}: company "${parsed.companyId}" is not registered with CIDCO`);
              return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }
            sftp.handle(
              reqid,
              newHandle({
                kind: 'file',
                fileName: base,
                dir: parsed.declaredPath,
                companyId: parsed.companyId,
                remote: filename,
                chunks: [],
                bytes: 0,
              }),
            );
          })();
          return;
        }

        // Remember the directory it is being written to — CIDCO validates it
        // against the registered file path when the handle closes. A bare
        // filename means the client's working directory, which is home.
        const dir = filename.includes('/') ? normalisePath(path.posix.dirname(filename)) : home;
        sftp.handle(reqid, newHandle({ kind: 'file', fileName: base, dir, remote: filename, chunks: [], bytes: 0 }));
      });

      sftp.on('WRITE', (reqid, handleBuf, _offset, data) => {
        const handle = readHandle(handleBuf);
        if (!handle || handle.kind !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
        handle.bytes += data.length;
        if (handle.bytes > MAX_UPLOAD_BYTES) {
          handle.chunks = [];
          return sftp.status(reqid, STATUS_CODE.FAILURE);
        }
        handle.chunks.push(Buffer.from(data));
        return sftp.status(reqid, STATUS_CODE.OK);
      });

      sftp.on('READ', (reqid) => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED));
      sftp.on('REMOVE', (reqid) => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED));
      sftp.on('RENAME', (reqid) => sftp.status(reqid, STATUS_CODE.OK));

      sftp.on('CLOSE', (reqid, handleBuf) => {
        const id = handleBuf.readUInt32BE(0);
        const handle = handles.get(id);
        handles.delete(id);
        if (!handle || handle.kind !== 'file') return sftp.status(reqid, STATUS_CODE.OK);

        // Record the size before answering: the client stats the path as soon
        // as the close returns.
        rememberReceived(handle.remote, handle.bytes);

        // Validate before answering, so the architect's agent learns the
        // verdict. Their only window onto CIDCO is what this close returns —
        // they cannot see the dashboard — so answering OK on a file we then
        // refuse would leave a misconfigured agent reporting success forever.
        void receiveFile(account, handle, ip)
          .then((accepted) =>
            sftp.status(reqid, accepted ? STATUS_CODE.OK : STATUS_CODE.PERMISSION_DENIED),
          )
          .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
      });
    });
  });
}

/**
 * Accepts a completed transfer into the inbox. Poll1 files it under
 * company/month/date/timestamp; poll2 runs the 10-step ingestion and archives.
 *
 * Returns whether the file was accepted into the inbox (what the client is told).
 */
async function receiveFile(account: Account, handle: WriteHandle, ip: string | null): Promise<boolean> {
  const { handshake } = account;
  const buffer = Buffer.concat(handle.chunks);
  const fileName = handle.fileName;

  if (!isAcceptedFile(fileName)) {
    log(`REJECTED ${fileName}: not an accepted file type`);
    return false;
  }
  if (buffer.length === 0) {
    log(`REJECTED ${fileName}: empty`);
    return false;
  }

  // Company from the upload path, the account, or the renamed filename.
  const fromName = parseAqiFileName(fileName)?.companyId;
  const companyId = handle.companyId || account.company?.companyId || fromName || null;
  const company = companyId
    ? await prisma.company.findUnique({ where: { companyId } })
    : account.company;

  try {
    const { inboxName } = await enqueueInboxFile({
      fileName,
      buffer,
      presentedPath: handle.dir,
      mode: 'DIRECT_SFTP',
      company,
      handshakeId: handshake.id,
    });

    log(
      `queued ${fileName} as ${inboxName} (${buffer.length} bytes) from ${handshake.clientId} ` +
        `at ${handle.dir} — waiting for poll1/poll2`,
    );

    await logComm({
      handshakeId: handshake.id,
      direction: 'ARCHITECT_TO_ADMIN',
      event: 'SFTP_FILE_RECEIVED',
      statusCode: 201,
      detail:
        `"${fileName}" (${buffer.length} bytes) queued for company ${companyId ?? '—'} ` +
        `from ${ip} at "${handle.dir}" — poll1 will file it, poll2 will ingest.`,
      ip,
    });
    return true;
  } catch (error) {
    log('failed to receive file:', error);
    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_FILE_REJECTED',
      statusCode: 500,
      detail: `Could not store "${fileName}": ${error instanceof Error ? error.message : String(error)}`,
      ip,
    });
    return false;
  }
}

// --- Boot ------------------------------------------------------------------

async function main() {
  await fs.mkdir(storageRoot(), { recursive: true });
  const key = await hostKey();

  const server = new Server(
    { hostKeys: [key], banner: 'CIDCO AQI Compliance Portal — SFTP intake' },
    (conn: Connection, info) => {
      const ip = (info.ip);
      let client = 'unknown SSH client';
      if (info.header?.versions?.software) client = info.header.versions.software;

      conn.on('authentication', (ctx) => {
        if (ctx.method !== 'password') {
          // Tell the client password is the only method we take.
          return ctx.reject(['password'], false);
        }
        void (async () => {
          try {
            const outcome = await authorise(ctx.username, ctx.password, ip, client);
            if (!outcome.ok) {
              log(`rejected ${ctx.username} from ${ip}: ${outcome.reason}`);
              if (outcome.event === 'SFTP_AUTH_FAILED' || outcome.event === 'SFTP_IP_REFUSED') {
                await logComm({
                  handshakeId: outcome.handshakeId,
                  direction: 'ARCHITECT_TO_ADMIN',
                  event: outcome.event,
                  statusCode: outcome.event === 'SFTP_IP_REFUSED' ? 403 : 401,
                  detail: outcome.reason,
                  ip,
                });
              }
              return ctx.reject();
            }

            const { handshake, company } = outcome.account;
            await logComm({
              handshakeId: handshake.id,
              direction: 'ARCHITECT_TO_ADMIN',
              event: 'SFTP_CONNECTED',
              statusCode: 200,
              detail:
                `SFTP session opened for ${company?.companyName} (${company?.companyId}) ` +
                `from ${ip ?? 'unknown'} · client: ${client}`,
              ip,
            });

            startSession(conn, outcome.account, ip);
            ctx.accept();
          } catch (error) {
            log('authentication error:', error);
            ctx.reject();
          }
        })();
      });

      conn.on('error', (err) => log('connection error:', err.message));
    },
  );

  server.listen(SFTP_PORT, HOST, () => {
    log(`CIDCO SFTP intake listening on ${HOST}:${SFTP_PORT}`);
    log(`uploads are stored under ${storageRoot()}`);
  });
}

main().catch((error) => {
  console.error('SFTP server failed to start:', error);
  process.exit(1);
});
