/**
 * End-to-end check of the AQI SFTP Ingestion Service, against a real database.
 *
 *   npm run poll:selftest
 *
 * It drops files into the inbox, runs poll1 and poll2, and asserts on what
 * ends up on disk and in the data table. The point is the failure paths: a
 * file that is empty, one whose header row is the wrong sheet, one whose
 * values are nonsense, one whose name the polls cannot read, and one sent
 * twice. Each must fail at its own step and say so in `fileStatus`.
 *
 * It writes to the configured DATABASE_URL, so point it at a dev database.
 */
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';

import { archiveRoot, inboxRoot, parseAqiFileName, runPoll1, runPoll2 } from '@/lib/ingestionPoll';
import { dataRoot, SHEET_COLUMNS } from '@/lib/sftp';

const quote = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
const headerRow = () => SHEET_COLUMNS.map((c) => quote(c.header)).join(',');

/** A sheet CIDCO should accept outright. */
function goodCsv(rows = 2) {
  const body = Array.from({ length: rows }, (_, i) =>
    SHEET_COLUMNS.map((c) =>
      quote(
        c.key === 'measuredAt' ? new Date(Date.now() - i * 3_600_000).toISOString()
        : c.key === 'aqiValue' ? String(120 + i)
        : String(c.example),
      ),
    ).join(','),
  );
  return [headerRow(), ...body].join('\n');
}

/** The right columns, nonsense in them — step 7's job, not step 6's. */
function badDataCsv() {
  const body = SHEET_COLUMNS.map((c) =>
    quote(c.key === 'measuredAt' ? 'not-a-date' : c.key === 'aqiValue' ? 'not-a-number' : String(c.example)),
  ).join(',');
  return [headerRow(), body].join('\n');
}

/**
 * A stamp in the shape the Windows agent sends: dd_mm_yyyy_hh-mm-ss.
 * Offset so each file in a run gets its own second.
 */
function stamp(offsetSeconds = 0) {
  const d = new Date(Date.now() + offsetSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${d.getFullYear()}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

async function drop(name: string, body: string) {
  await fs.mkdir(inboxRoot(), { recursive: true });
  await fs.writeFile(path.join(inboxRoot(), name), body);
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  // A clean slate, so a previous run's archive cannot be read as this run's.
  await fs.rm(inboxRoot(), { recursive: true, force: true });
  await fs.rm(archiveRoot(), { recursive: true, force: true });
  await fs.rm(dataRoot(), { recursive: true, force: true });
  await prisma.dataFile.deleteMany({});

  const good = stamp();
  const unregistered = stamp(-60);
  const empty = stamp(-120);
  const wrongColumns = stamp(-180);
  const wrongData = stamp(-240);

  await drop(`ABCD123_${good}_AQI.csv`, goodCsv());
  // A company CIDCO never registered still gets its data in.
  await drop(`NEWCO777_${unregistered}_AQI.csv`, goodCsv());
  await drop(`ABCD123_${empty}_AQI.csv`, '');
  await drop(`ABCD123_${wrongColumns}_AQI.csv`, 'foo,bar\n1,2\n');
  await drop(`ABCD123_${wrongData}_AQI.csv`, badDataCsv());
  // Not in the agent's naming scheme: poll1 must leave it alone.
  await drop('reading.csv', goodCsv());

  // --- poll1 -------------------------------------------------------------
  const poll1 = await runPoll1();
  check('poll1 files every well-named CSV', poll1.moved === 5, `moved=${poll1.moved}`);
  check('poll1 refuses a name it cannot read', poll1.errors.some((e) => e.startsWith('reading.csv')));
  check('the refused file stays in the inbox', (await fs.readdir(inboxRoot())).includes('reading.csv'));

  const filed = await prisma.dataFile.findMany({ orderBy: { receivedAt: 'asc' } });
  check('poll1 indexes every filed CSV', filed.length === 5, `rows=${filed.length}`);

  for (const row of filed) {
    const parsed = parseAqiFileName(row.deliveredName!)!;
    const expected = `${row.companyId}/${parsed.dateFolder}/${parsed.timeStem}.csv`;
    check(`  ${row.deliveredName} filed as companyId/dd_mm_yyyy/hh-mm-ss.csv`,
      row.relativePath === expected, row.relativePath);
    check(`  ${row.relativePath} is on disk`, await exists(path.join(dataRoot(), row.relativePath)));
    check(`  ${row.relativePath} has no colon in it`, !row.relativePath.includes(':'));
  }

  const auto = await prisma.company.findUnique({ where: { companyId: 'NEWCO777' } });
  check('poll1 registers a company it has never seen', Boolean(auto));

  // --- poll2 -------------------------------------------------------------
  await runPoll2();
  const done = await prisma.dataFile.findMany({ orderBy: { receivedAt: 'asc' } });

  for (const row of done) {
    const steps = (row.fileStatus ?? '').split('\n').filter((l) => /^\d+\. /.test(l));
    check(`  ${row.fileName} lists all ten steps`, steps.length === 10, `listed=${steps.length}`);
  }

  const archived = done.filter((f) => f.pollStatus === 'ARCHIVED');
  const failed = done.filter((f) => f.pollStatus === 'FAILED');
  check('the two good files are archived', archived.length === 2, `archived=${archived.length}`);
  check('the three broken files failed', failed.length === 3, `failed=${failed.length}`);
  check('an archived file reads CORRECT', archived.every((f) => f.fileStatus?.startsWith('CORRECT')));
  check('an archived file carries its AQI rows',
    archived.every((f) => Array.isArray(f.aqiData) && (f.aqiData as unknown[]).length === 2));

  for (const row of archived) {
    // The date folder comes along, or every day's 11-30-24.csv would collide.
    check(`  ${row.relativePath} archived under its date`,
      await exists(path.join(archiveRoot(), row.companyId, row.dateFolder, row.fileName)));
    const stillFiled = path.join(dataRoot(), row.companyId, row.dateFolder, row.fileName);
    check(`  ${row.fileName} left the data tree`, !(await exists(stillFiled)));
  }

  // Each broken file fails at its own step, and says nothing about the rest.
  const emptyRow = failed.find((f) => f.sizeBytes === 0);
  check('an empty file fails at step 2', Boolean(emptyRow?.fileStatus?.includes('2. Check file completeness — FAILED')));
  check('and its later steps read NOT REACHED', Boolean(emptyRow?.fileStatus?.includes('NOT REACHED')));

  const columnsRow = failed.find((f) => f.fileStatus?.includes('6. Validate columns — FAILED'));
  check('the wrong sheet fails at step 6', Boolean(columnsRow),
    columnsRow?.fileStatus?.split('\n').find((l) => l.includes('FAILED')));
  check('a step-6 failure does not claim to have validated data',
    Boolean(columnsRow?.fileStatus?.includes('7. Validate data — NOT REACHED')));

  const dataRow = failed.find((f) => f.fileStatus?.includes('7. Validate data — FAILED'));
  check('nonsense values fail at step 7', Boolean(dataRow),
    dataRow?.fileStatus?.split('\n').find((l) => l.includes('FAILED')));

  check('readings reached the reports table',
    (await prisma.report.count({ where: { source: 'SFTP' } })) > 0);

  // --- two deliveries landing on the same second -------------------------
  const sameSecond = stamp(-300);
  await drop(`ABCD123_${sameSecond}_AQI.csv`, goodCsv());
  await runPoll1();
  const firstOfPair = await prisma.dataFile.findFirst({ where: { deliveredName: `ABCD123_${sameSecond}_AQI.csv` } });
  await drop(`ABCD123_${sameSecond}_AQI.csv`, goodCsv(3));
  await runPoll1();
  const pair = await prisma.dataFile.findMany({ where: { deliveredName: `ABCD123_${sameSecond}_AQI.csv` } });
  check('a second delivery on the same second is kept, not overwritten', pair.length === 2, `rows=${pair.length}`);
  check('  and it is filed under its own name',
    new Set(pair.map((r) => r.relativePath)).size === 2, pair.map((r) => r.relativePath).join(' , '));
  check('  the first file still exists',
    await exists(path.join(dataRoot(), firstOfPair!.relativePath)));

  // --- the same delivery twice -------------------------------------------
  await drop(`ABCD123_${good}_AQI.csv`, goodCsv());
  await runPoll1();
  await runPoll2();
  // `fileName` is the leaf now (11-30-24.csv), so the re-send is found by the
  // flat name the agent delivered it under.
  const duplicate = await prisma.dataFile.findFirst({
    where: { deliveredName: `ABCD123_${good}_AQI.csv`, pollStatus: 'FAILED' },
    orderBy: { receivedAt: 'desc' },
  });
  check('a re-sent file is caught at step 8',
    Boolean(duplicate?.fileStatus?.includes('8. Check duplicate — FAILED')),
    duplicate?.fileStatus?.split('\n').find((l) => l.startsWith('8.')));

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
