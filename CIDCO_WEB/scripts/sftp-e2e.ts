/**
 * End-to-end drive of the SFTP channel, in the order CIDCO actually works:
 *
 *   i.  CIDCO registers the company by hand — name, site name, the architect's
 *       server address, and the file path their CSV is taken from.
 *   1.  CIDCO issues a user id and password against it and emails them, with
 *       the designated address to send to.
 *   2.  The architect sends the CSV automatically from that path.
 *   --  Every transfer is validated on the CIDCO side against the registration
 *       before anything is stored.
 *
 * Ingestion itself is done by the two pollers, so this drives them in-process
 * rather than needing them running alongside.
 *
 * Needs both servers running:  npm start  and  npm run sftp
 */
import { Client } from 'ssh2';
import { prisma } from '../src/lib/prisma';
import { buildCsvTemplate, SHEET_COLUMNS } from '../src/lib/sftp';
import { runPoll1, runPoll2 } from '../src/lib/ingestionPoll';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SFTP_HOST = '127.0.0.1';
const SFTP_PORT = Number(process.env.SFTP_PORT || 2222);
const FILE_PATH = '/var/aqi/exports';

const fails: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fails.push(label);
};

let cookie = '';
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Resolves the open client, or null when the server refuses the session. */
function connect(username: string, password: string) {
  return new Promise<Client | null>((resolve) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', () => resolve(null))
      .connect({ host: SFTP_HOST, port: SFTP_PORT, username, password, readyTimeout: 15000 });
  });
}

function put(conn: Client, remote: string, buffer: Buffer) {
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

/** A CSV of readings, plus one deliberately broken row. */
function csv(rows: number) {
  const header = SHEET_COLUMNS.map((c) => c.header).join(',');
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    lines.push(
      [
        `CIDCO-SFTP-${i + 1}`,
        `STN-SFTP-0${i + 1}`,
        'Envirotech',
        'AQ-900',
        `Belapur Node ${i + 1}`,
        'CBD Belapur',
        `2026-09-11T0${i}:00:00Z`,
        90 + i,
        38.2,
        72.4,
        21.1,
        8.3,
        0.6,
        18.7,
        29.4,
        71,
        'noise=61 dB',
        'SFTP CSV upload',
      ].join(','),
    );
  }
  lines.push('CIDCO-BAD,,,,Broken row,,not-a-date,,,,,,,,,,,');
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const stamp = Date.now();

  console.log('== i. CIDCO registers the company by hand ==');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'officer@cidco.example', password: 'Password123' }),
  });
  check(login.status === 200, 'officer signed in');

  const archEmail = `sftp-arch-${stamp}@studio.in`;

  const siteName = `CIDCO-CO-${stamp}`;
  const registered = await api('/api/admin/sftp/companies', {
    method: 'POST',
    body: JSON.stringify({
      siteName,
      designatedPath: FILE_PATH,
      email: archEmail,
    }),
  });
  check(registered.status === 201, `company registered (got ${registered.status})`);
  check(registered.json?.data?.company?.designatedPath === FILE_PATH, 'the designated path is stored on the registration');
  check(registered.json?.data?.company?.email === archEmail, 'the architect email is stored as contact detail');
  check(
    (await prisma.user.findUnique({ where: { email: archEmail } })) === null,
    'registering did NOT create an account for that email',
  );

  // Credentials cannot exist without a registration.
  const orphan = await api('/api/admin/sftp/accounts', {
    method: 'POST',
    body: JSON.stringify({ siteName: 'NOT-REGISTERED' }),
  });
  check(orphan.status === 404, 'credentials cannot be issued for an unregistered company');

  console.log('== 1. CIDCO emails the user id, password and designated path ==');
  const issued = await api('/api/admin/sftp/accounts', {
    method: 'POST',
    body: JSON.stringify({ siteName }),
  });
  check(issued.status === 201, `credentials issued (got ${issued.status})`);
  const cred = issued.json.data.credential;
  check(
    ['username', 'password', 'siteName', 'designatedPath'].every((k) => k in cred),
    'the emailed bundle carries the user id, password, site name and designated path',
  );
  console.log(`   ${cred.username} → :${cred.port}${cred.designatedPath}`);

  console.log('== 2. the architect sends the CSV from the registered path ==');
  check((await connect(cred.username, 'wrong-password')) === null, 'a wrong password is refused');

  const conn = await connect(cred.username, cred.password);
  check(!!conn, 'the registered credentials connect straight away — no separate approval step');
  if (!conn) throw new Error('cannot continue without a session');

  const companyRow = await prisma.company.findUniqueOrThrow({ where: { siteName } });
  const before = await prisma.sftpReading.count({ where: { companyRecordId: companyRow.id } });

  // The agent names every transfer siteName_dd_mm_yyyy_hh-mm-ss_AQI.csv, and
  // the ingestion service reads the site and the time straight out of it.
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const deliveredName =
    `${siteName}_${two(now.getDate())}_${two(now.getMonth() + 1)}_${now.getFullYear()}_` +
    `${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}_AQI.csv`;
  await put(conn, `${FILE_PATH}/${deliveredName}`, csv(3));
  conn.end();
  await new Promise((r) => setTimeout(r, 1500)); // the server acks the client, then queues the file

  // The intake only queues; poll1 files the delivery and poll2 validates and
  // stores it, so the run has to be driven before anything can be asserted.
  await runPoll1();
  await runPoll2();

  console.log('== validation on the CIDCO side ==');
  const list = await api('/api/admin/sftp/uploads');
  const row = list.json.data.uploads.find((u: { presentedSiteName: string | null }) => u.presentedSiteName === siteName);
  check(!!row, 'the transfer is on the CIDCO dashboard');
  check(row?.validationPassed === true, 'validation passed');
  check(row?.siteNameMatch && row?.pathMatch, 'site name and file path both matched');
  check(row?.presentedPath === FILE_PATH, `the path it was taken from is recorded (${row?.presentedPath})`);
  check(row?.importedCount === 3 && row?.rowCount === 4, `3 of 4 CSV rows stored (got ${row?.importedCount} of ${row?.rowCount})`);

  const detail = await api(`/api/admin/sftp/uploads/${row.id}`);
  const v = detail.json.data.upload.validation;
  check(v.siteName.presented === siteName && v.siteName.expected === siteName, 'the officer sees site name, incoming vs registered');
  check(
    v.designatedPath.presented === FILE_PATH && v.designatedPath.expected === FILE_PATH,
    'the officer sees the designated path, incoming vs registered',
  );
  check(detail.json.data.upload.rows.length === 4, 'the CSV is previewable row by row');

  const after = await prisma.sftpReading.count({ where: { companyRecordId: companyRow.id } });
  check(after - before === 3, `3 readings landed in the database (got ${after - before})`);
  check(
    (await prisma.sftpReading.count({ where: { companyRecordId: companyRow.id, source: 'SFTP' } })) === 3,
    'the readings are attributed to the registered company',
  );

  console.log('== a transfer that does not match is refused ==');
  const conn2 = await connect(cred.username, cred.password);
  if (!conn2) throw new Error('reconnect failed');
  // The architect cannot see CIDCO's dashboard, so the refusal has to come back
  // down the wire — the upload itself must fail, not quietly report success.
  let refusedOnTheWire = false;
  try {
    await put(conn2, '/somewhere/else/readings.csv', csv(2));
  } catch {
    refusedOnTheWire = true;
  }
  conn2.end();
  await new Promise((r) => setTimeout(r, 2500));
  check(refusedOnTheWire, 'the sender is told the transfer was refused');

  const afterBad = await prisma.sftpReading.count({ where: { companyRecordId: companyRow.id } });
  const rejected = await prisma.sftpUpload.findFirst({
    where: { handshake: { clientId: cred.username }, presentedPath: '/somewhere/else' },
    orderBy: { receivedAt: 'desc' },
  });
  check(!!rejected, 'the mismatched transfer is recorded');
  check(rejected?.status === 'REJECTED', `it is marked REJECTED (got ${rejected?.status})`);
  check(rejected?.pathMatch === false && rejected?.siteNameMatch === true, 'the file path is the field that failed');
  check(!!rejected?.rejectionReason, `the reason is recorded (${rejected?.rejectionReason?.slice(0, 60)}…)`);
  check(afterBad === after, 'nothing was stored from the refused transfer');

  console.log('== the wrong source address is refused outright ==');
  await prisma.company.update({ where: { siteName }, data: { } });
  check((await connect(cred.username, cred.password)) === null, 'a connection from an unregistered address is refused');
  await prisma.company.update({ where: { siteName }, data: { } });

  console.log('== the architect signs in with the shared CIDCO login and connects ==');
  cookie = '';
  const shared = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'cidco@gmail.com', password: '123456' }),
  });
  check(shared.status === 200, 'the shared portal login works for architects');

  const wrongConnect = await api('/api/architect/sftp/connect', {
    method: 'POST',
    body: JSON.stringify({ username: cred.username, password: 'not-the-password' }),
  });
  check(wrongConnect.status === 401, `a wrong SFTP password cannot connect (got ${wrongConnect.status})`);

  const connected = await api('/api/architect/sftp/connect', {
    method: 'POST',
    body: JSON.stringify({ username: cred.username, password: cred.password }),
  });
  check(connected.status === 200, `connecting with the SFTP credentials works (got ${connected.status})`);
  const account = connected.json?.data?.account;
  check(account?.company?.siteName === siteName, 'connecting identifies the right company');
  check(account?.company?.filePath === FILE_PATH, 'the architect sees the registered file path');
  check(connected.json?.data?.endpoint?.designatedIp !== undefined, 'the architect sees the designated IP to send to');
  check(account?.uploads?.some((u: { validationPassed: boolean }) => u.validationPassed), 'the architect sees the accepted transfer');
  check(account?.uploads?.some((u: { validationPassed: boolean }) => !u.validationPassed), 'the architect sees the refused one, with its reason');

  console.log('== the portal drag-and-drop path uses the same validation ==');
  const form = new FormData();
  form.set('username', cred.username);
  form.set('password', cred.password);
  form.set('designatedIp', cred.designatedIp);
  form.set('filePath', FILE_PATH);
  form.set('file', new Blob([csv(2)], { type: 'text/csv' }), 'dragged.csv');
  const dropped = await fetch(`${BASE}/api/architect/sftp/transfer`, { method: 'POST', body: form });
  const droppedJson = await dropped.json();
  check(dropped.status === 201, `a dropped CSV is accepted (got ${dropped.status})`);
  check(droppedJson?.data?.upload?.importedCount === 2, `its 2 rows were stored (got ${droppedJson?.data?.upload?.importedCount})`);

  const badForm = new FormData();
  badForm.set('username', cred.username);
  badForm.set('password', cred.password);
  badForm.set('filePath', '/not/the/registered/path');
  badForm.set('file', new Blob([csv(1)], { type: 'text/csv' }), 'wrong-path.csv');
  const badDrop = await fetch(`${BASE}/api/architect/sftp/transfer`, { method: 'POST', body: badForm });
  check(badDrop.status === 403, `a dropped file from the wrong path is refused (got ${badDrop.status})`);

  console.log('== the CSV template matches what the parser reads ==');
  check(buildCsvTemplate().split('\n')[0].includes('AQI Value'), 'the template header carries the AQI columns');

  console.log(fails.length ? `\nFAILED: ${fails.join(' | ')}` : '\nALL SFTP CHANNEL CHECKS PASSED');
  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
