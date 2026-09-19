/**
 * The architect's automated sender.
 *
 * Runs on the architect's own server. Using the user id, password and
 * designated address CIDCO emailed, it takes the CSV from the registered file
 * path and sends it over SFTP — on an interval, unattended.
 *
 * Because it runs on the architect's own machine, the address CIDCO sees is the
 * architect's real server address, which is exactly what CIDCO validates each
 * transfer against.
 *
 *   SFTP_USER=sftp_xxx SFTP_PASSWORD=... SFTP_DESIGNATED_IP=cidco.example \\
 *   SFTP_FILE_PATH=/var/aqi/exports npx tsx scripts/architect-sender.ts
 *
 * Add --once to send a single time instead of looping.
 */
import fs from 'fs/promises';
import path from 'path';
import { Client } from 'ssh2';

const USER = process.env.SFTP_USER ?? '';
const PASSWORD = process.env.SFTP_PASSWORD ?? '';
const HOST = process.env.SFTP_DESIGNATED_IP ?? '127.0.0.1';
const PORT = Number(process.env.SFTP_DESIGNATED_PORT ?? process.env.SFTP_PORT ?? 2222);
/** The path CIDCO registered — the file is taken from here and sent to here. */
const FILE_PATH = process.env.SFTP_FILE_PATH ?? '';
const EVERY_MINUTES = Number(process.env.SFTP_EVERY_MINUTES ?? 180); // 3 hours
const ONCE = process.argv.includes('--once');

function log(...parts: unknown[]) {
  console.log(`[sender ${new Date().toISOString()}]`, ...parts);
}

/** The newest .csv (or .xlsx) sitting in the registered export directory. */
async function newestExport(dir: string) {
  const names = await fs.readdir(dir);
  const candidates = names.filter((n) => /\.(csv|xlsx)$/i.test(n));
  if (candidates.length === 0) return null;

  const stats = await Promise.all(
    candidates.map(async (name) => ({ name, stat: await fs.stat(path.join(dir, name)) })),
  );
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return stats[0].name;
}

function connect() {
  return new Promise<Client>((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
  });
}

function put(conn: Client, buffer: Buffer, remote: string) {
  return new Promise<void>((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remote);
      stream.on('close', () => resolve());
      stream.on('error', reject);
      stream.end(buffer);
    });
  });
}

async function sendOnce() {
  const name = await newestExport(FILE_PATH);
  if (!name) {
    log(`nothing to send — no .csv in ${FILE_PATH}`);
    return;
  }

  const local = path.join(FILE_PATH, name);
  const buffer = await fs.readFile(local);
  // Written to the same path CIDCO registered, which is what it validates.
  const remote = `${FILE_PATH.replace(/\/+$/, '')}/${name}`;

  const conn = await connect();
  try {
    await put(conn, buffer, remote);
    log(`sent ${name} (${buffer.length} bytes) to ${HOST}:${PORT}${remote}`);
  } finally {
    conn.end();
  }
}

async function main() {
  if (!USER || !PASSWORD || !FILE_PATH) {
    console.error(
      'Set SFTP_USER, SFTP_PASSWORD and SFTP_FILE_PATH (and SFTP_DESIGNATED_IP) — the values CIDCO emailed you.',
    );
    process.exit(1);
  }

  log(`sending from ${FILE_PATH} to ${USER}@${HOST}:${PORT}${ONCE ? ' (once)' : ` every ${EVERY_MINUTES} min`}`);

  const run = async () => {
    try {
      await sendOnce();
    } catch (error) {
      // Keep the loop alive: CIDCO may be down, or a transfer may be refused.
      log('send failed:', error instanceof Error ? error.message : error);
    }
  };

  await run();
  if (ONCE) return;
  setInterval(() => void run(), EVERY_MINUTES * 60_000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
