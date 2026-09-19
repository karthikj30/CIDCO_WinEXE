import fs from 'fs/promises';
import path from 'path';
import type { Company, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  dataRoot,
  importRows,
  isAcceptedFile,
  monthFolderFor,
  parseDataFile,
  safeFolder,
  sharedLoginHandshake,
  timestampFolderFor,
  validateColumns,
  validateRows,
} from '@/lib/sftp';

/**
 * AQI SFTP Ingestion Service — two polls:
 *
 *   Poll 1  inbox → company/month/date/timestamp/<file>
 *   Poll 2  filed file → validate (10 steps) → DB → archive
 *
 * The Windows agent only drops a renamed CSV
 * (`companyId_yyyy-MM-dd_HH-mm-ss_AQI.csv`) into intake. Folder creation and
 * database work live here.
 */

export const INGESTION_STEPS = [
  '1. Detect new file',
  '2. Check file completeness',
  '3. Validate file type',
  '4. Validate filename',
  '5. Validate Project/Site',
  '6. Validate columns',
  '7. Validate data',
  '8. Check duplicate',
  '9. Store audit information',
  '10. Move file',
] as const;

export type IngestionStepResult = {
  step: (typeof INGESTION_STEPS)[number];
  ok: boolean;
  detail: string;
};

/** Filename the Windows agent always sends: ABCD123_2026-09-19_13-28-49_AQI.csv */
const AQI_FILE_RE =
  /^(.+)_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_AQI\.(csv|xlsx)$/i;

export type ParsedAqiFileName = {
  companyId: string;
  date: string; // yyyy-MM-dd
  time: string; // HH-mm-ss
  timestamp: string; // yyyy-MM-dd_HH-mm-ss
  extension: string;
};

export function parseAqiFileName(fileName: string): ParsedAqiFileName | null {
  const base = path.basename(fileName);
  const match = AQI_FILE_RE.exec(base);
  if (!match) return null;
  const [, companyId, date, time, extension] = match;
  return {
    companyId,
    date,
    time,
    timestamp: `${date}_${time}`,
    extension: extension.toLowerCase(),
  };
}

export function inboxRoot() {
  return path.resolve(process.env.CIDCO_INBOX_DIR || './storage/inbox');
}

export function archiveRoot() {
  return path.resolve(process.env.CIDCO_ARCHIVE_DIR || './storage/archive');
}

/** month / date / timestamp folders from a parsed stamp. */
export function folderPartsFromStamp(parsed: ParsedAqiFileName) {
  const [y, m, d] = parsed.date.split('-').map(Number);
  const [hh, mm, ss] = parsed.time.split('-').map(Number);
  const at = new Date(y, m - 1, d, hh, mm, ss);
  return {
    monthFolder: monthFolderFor(at),
    dateFolder: parsed.date,
    timestampFolder: parsed.timestamp,
    at,
  };
}

/**
 * Where poll1 files a CSV:
 *
 *   <dataRoot>/<companyId>/<month>/<date>/<timestamp>/<file>
 */
export function pollTreeLocation(companyId: string, fileName: string, parsed: ParsedAqiFileName) {
  const company = safeFolder(companyId);
  const { monthFolder, dateFolder, timestampFolder } = folderPartsFromStamp(parsed);
  const safeName = safeFolder(fileName).replace(/_+/g, '_');
  const relativePath = `${company}/${monthFolder}/${dateFolder}/${timestampFolder}/${safeName}`;
  return {
    monthFolder,
    dateFolder,
    timestampFolder,
    relativePath,
    absolutePath: path.join(dataRoot(), company, monthFolder, dateFolder, timestampFolder, safeName),
  };
}

/**
 * The file status always lists all ten steps.
 *
 * A run stops at the first failure, so only the steps up to it have a result.
 * Reporting just those would leave the officer reading the dashboard unable to
 * tell a step that passed from one that never ran — and the whole point of the
 * status is to say which step is missing. So the steps after the failure are
 * spelled out as NOT REACHED rather than left off.
 */
function formatFileStatus(steps: IngestionStepResult[]): string {
  const done = new Map(steps.map((s) => [s.step, s]));
  const failedAt = steps.find((s) => !s.ok)?.step;

  return INGESTION_STEPS.map((step) => {
    const result = done.get(step);
    if (!result) return `${step} — NOT REACHED${failedAt ? ` (stopped at ${failedAt})` : ''}`;
    return `${step} — ${result.ok ? 'OK' : `FAILED: ${result.detail}`}`;
  }).join('\n');
}

function allCorrect(steps: IngestionStepResult[]): boolean {
  return steps.every((s) => s.ok);
}

/** Drop a received transfer into the inbox for poll1. Does not create the data tree. */
export async function enqueueInboxFile(params: {
  fileName: string;
  buffer: Buffer;
  sourceIp: string | null;
  presentedPath: string | null;
  mode: 'DIRECT_SFTP' | 'PORTAL';
  company: Company | null;
  handshakeId: string;
}) {
  const { fileName, buffer, sourceIp, presentedPath, mode, company, handshakeId } = params;
  await fs.mkdir(inboxRoot(), { recursive: true });

  const parsed = parseAqiFileName(fileName);
  const stamp = Date.now();
  const inboxName = parsed
    ? fileName
    : `${stamp}_${safeFolder(fileName)}`;
  const inboxPath = path.join(inboxRoot(), inboxName);
  await fs.writeFile(inboxPath, buffer);

  const upload = await prisma.sftpUpload.create({
    data: {
      handshakeId,
      fileName: inboxName,
      storedName: inboxName,
      sizeBytes: buffer.length,
      sourceIp,
      mode,
      presentedCompanyId: parsed?.companyId ?? company?.companyId ?? null,
      presentedIp: sourceIp,
      presentedPath,
      companyIdMatch: Boolean(company && parsed && company.companyId === parsed.companyId),
      ipMatch: false,
      pathMatch: !presentedPath || !company?.filePath,
      validationPassed: false,
      status: 'RECEIVED',
      rejectionReason: null,
    },
  });

  // Index as soon as it lands in the inbox so the dashboard can show progress.
  if (company) {
    await prisma.dataFile.create({
      data: {
        companyRecordId: company.id,
        companyId: company.companyId,
        monthFolder: parsed ? folderPartsFromStamp(parsed).monthFolder : 'pending',
        dateFolder: parsed?.date ?? 'pending',
        timestampFolder: parsed?.timestamp ?? 'pending',
        timestamp: parsed?.timestamp ?? null,
        relativePath: `inbox/${inboxName}`,
        fileName: inboxName,
        sizeBytes: buffer.length,
        rowCount: 0,
        importedCount: 0,
        sourceIp,
        uploadId: upload.id,
        pollStatus: 'INBOX',
        fileStatus: `${INGESTION_STEPS[0]} — OK (queued for poll1)`,
        aqiData: undefined,
      },
    });
  }

  return { upload, inboxPath, inboxName };
}

/**
 * Poll 1 — fetch companyId + timestamp from the filename, ensure
 * company/month/date/timestamp exists (create if missing), move the file there.
 */
export async function runPoll1(): Promise<{ moved: number; errors: string[] }> {
  await fs.mkdir(inboxRoot(), { recursive: true });
  await fs.mkdir(dataRoot(), { recursive: true });

  const entries = await fs.readdir(inboxRoot(), { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && isAcceptedFile(e.name));
  let moved = 0;
  const errors: string[] = [];

  for (const entry of files) {
    const inboxPath = path.join(inboxRoot(), entry.name);
    try {
      const parsed = parseAqiFileName(entry.name);
      if (!parsed) {
        errors.push(`${entry.name}: filename must be companyId_yyyy-MM-dd_HH-mm-ss_AQI.csv`);
        continue;
      }

      let company = await prisma.company.findUnique({ where: { companyId: parsed.companyId } });
      // Even without a registration, still file under the company id from the name.
      if (!company) {
        const owner = await sharedLoginHandshake();
        company = await prisma.company.create({
          data: {
            companyId: parsed.companyId,
            companyName: parsed.companyId,
            architectServerIp: '0.0.0.0',
            filePath: '',
            userId: owner?.architectId ?? null,
            active: true,
            notes: 'Auto-created by poll1 from inbound filename (no prior registration)',
          },
        });
      }

      const where = pollTreeLocation(parsed.companyId, entry.name, parsed);
      await fs.mkdir(path.dirname(where.absolutePath), { recursive: true });
      await fs.rename(inboxPath, where.absolutePath).catch(async () => {
        // Cross-device rename fallback.
        const buf = await fs.readFile(inboxPath);
        await fs.writeFile(where.absolutePath, buf);
        await fs.unlink(inboxPath);
      });

      const upload = await prisma.sftpUpload.findFirst({
        where: { storedName: entry.name },
        orderBy: { receivedAt: 'desc' },
      });

      const existing = upload?.id
        ? await prisma.dataFile.findUnique({ where: { uploadId: upload.id } })
        : null;

      if (existing) {
        await prisma.dataFile.update({
          where: { id: existing.id },
          data: {
            companyRecordId: company.id,
            companyId: company.companyId,
            monthFolder: where.monthFolder,
            dateFolder: where.dateFolder,
            timestampFolder: where.timestampFolder,
            timestamp: parsed.timestamp,
            relativePath: where.relativePath,
            fileName: entry.name,
            sizeBytes: (await fs.stat(where.absolutePath)).size,
            pollStatus: 'FILED',
            fileStatus: [
              `${INGESTION_STEPS[0]} — OK`,
              `Filed at ${where.relativePath} (poll1)`,
            ].join('\n'),
          },
        });
      } else {
        await prisma.dataFile.create({
          data: {
            companyRecordId: company.id,
            companyId: company.companyId,
            monthFolder: where.monthFolder,
            dateFolder: where.dateFolder,
            timestampFolder: where.timestampFolder,
            timestamp: parsed.timestamp,
            relativePath: where.relativePath,
            fileName: entry.name,
            sizeBytes: (await fs.stat(where.absolutePath)).size,
            pollStatus: 'FILED',
            fileStatus: [
              `${INGESTION_STEPS[0]} — OK`,
              `Filed at ${where.relativePath} (poll1)`,
            ].join('\n'),
            uploadId: upload?.id,
          },
        });
      }

      moved += 1;
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { moved, errors };
}

/**
 * Poll 2 — for each filed (not yet archived) file: run the 10-step ingestion,
 * insert AQI rows, update fileStatus, move to archive.
 */
export async function runPoll2(): Promise<{ processed: number; errors: string[] }> {
  await fs.mkdir(archiveRoot(), { recursive: true });

  const pending = await prisma.dataFile.findMany({
    where: { pollStatus: 'FILED' },
    include: { company: true },
    orderBy: { receivedAt: 'asc' },
    take: 50,
  });

  let processed = 0;
  const errors: string[] = [];

  for (const row of pending) {
    try {
      // Claim the row, and only carry on if this run is the one that got it.
      // A plain update would let two poll runs both take a file that was
      // FILED when they each read it, and ingest the same delivery twice.
      const claimed = await prisma.dataFile.updateMany({
        where: { id: row.id, pollStatus: 'FILED' },
        data: { pollStatus: 'INGESTING' },
      });
      if (claimed.count === 0) continue;

      const absolute = path.join(dataRoot(), row.relativePath);
      const steps: IngestionStepResult[] = [];
      const mark = (step: (typeof INGESTION_STEPS)[number], ok: boolean, detail: string) => {
        steps.push({ step, ok, detail });
      };

      // 1. Detect new file
      let buffer: Buffer | null = null;
      try {
        buffer = await fs.readFile(absolute);
        mark(INGESTION_STEPS[0], true, `${row.fileName} (${buffer.length} bytes)`);
      } catch {
        mark(INGESTION_STEPS[0], false, `file missing at ${row.relativePath}`);
        await failRow(row.id, steps);
        errors.push(`${row.fileName}: missing file`);
        continue;
      }

      // 2. Completeness
      if (buffer.length === 0) {
        mark(INGESTION_STEPS[1], false, 'file is empty');
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[1], true, `${buffer.length} bytes`);

      // 3. File type
      if (!isAcceptedFile(row.fileName)) {
        mark(INGESTION_STEPS[2], false, 'not .csv or .xlsx');
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[2], true, path.extname(row.fileName).toLowerCase());

      // 4. Filename
      const parsed = parseAqiFileName(row.fileName);
      if (!parsed) {
        mark(INGESTION_STEPS[3], false, 'expected companyId_yyyy-MM-dd_HH-mm-ss_AQI.csv');
        await failRow(row.id, steps);
        continue;
      }
      if (parsed.companyId !== row.companyId) {
        mark(INGESTION_STEPS[3], false, `filename company ${parsed.companyId} ≠ row ${row.companyId}`);
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[3], true, parsed.timestamp);

      // 5. Project/Site (company registration)
      if (!row.company || !row.company.active) {
        mark(INGESTION_STEPS[4], false, 'company inactive or missing');
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[4], true, row.company.companyId);

      // 6–7. Columns + data
      let sheet;
      try {
        sheet = await parseDataFile(buffer, row.fileName);
      } catch (error) {
        mark(INGESTION_STEPS[5], false, error instanceof Error ? error.message : String(error));
        mark(INGESTION_STEPS[6], false, 'skipped — columns failed');
        await failRow(row.id, steps);
        continue;
      }

      if (!sheet.columns.length) {
        mark(INGESTION_STEPS[5], false, 'no header row');
        await failRow(row.id, steps);
        continue;
      }

      // A header row of "foo,bar" is a header row. Only checking it against
      // the columns CIDCO published tells the officer the sheet is the wrong
      // sheet, rather than reporting one validation error per row.
      const columnCheck = validateColumns(sheet.columns);
      if (!columnCheck.ok) {
        mark(
          INGESTION_STEPS[5],
          false,
          `missing required column(s): ${columnCheck.missing.join(', ')}` +
            (columnCheck.unrecognised.length
              ? `; unrecognised header(s): ${columnCheck.unrecognised.join(', ')}`
              : ''),
        );
        await failRow(row.id, steps);
        continue;
      }
      mark(
        INGESTION_STEPS[5],
        true,
        `${columnCheck.recognisedCount}/${sheet.columns.length} columns recognised` +
          (columnCheck.unrecognised.length
            ? `, ignoring ${columnCheck.unrecognised.join(', ')}`
            : ''),
      );

      // 7. Data
      if (!sheet.rows.length) {
        mark(INGESTION_STEPS[6], false, 'no data rows');
        await failRow(row.id, steps);
        continue;
      }

      const rowCheck = validateRows(sheet.rows);
      if (!rowCheck.ok) {
        mark(
          INGESTION_STEPS[6],
          false,
          `no valid row in ${rowCheck.rowCount}: ` +
            rowCheck.errors.slice(0, 5).map((e) => `row ${e.row}: ${e.error}`).join('; '),
        );
        await failRow(row.id, steps, { rowCount: rowCheck.rowCount, importedCount: 0 });
        continue;
      }
      mark(
        INGESTION_STEPS[6],
        true,
        `${rowCheck.validCount}/${rowCheck.rowCount} rows valid` +
          (rowCheck.errors.length
            ? `, ${rowCheck.errors.length} rejected (${rowCheck.errors
                .slice(0, 3)
                .map((e) => `row ${e.row}: ${e.error}`)
                .join('; ')})`
            : ''),
      );

      // 8. Duplicate — same company + timestamp + relative path already archived
      // Only a real timestamp identifies a file. Matching on a null one would
      // make every unstamped file a duplicate of the last unstamped file.
      const duplicate = row.timestamp
        ? await prisma.dataFile.findFirst({
            where: {
              companyId: row.companyId,
              timestamp: row.timestamp,
              pollStatus: 'ARCHIVED',
              id: { not: row.id },
            },
          })
        : null;
      if (duplicate) {
        mark(INGESTION_STEPS[7], false, `duplicate of ${duplicate.relativePath}`);
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[7], true, 'no prior archive for this timestamp');

      // 9. Store
      const handshake = await sharedLoginHandshake();
      if (!handshake) {
        mark(INGESTION_STEPS[8], false, 'no shared handshake to attribute readings');
        await failRow(row.id, steps);
        continue;
      }

      const outcome = await importRows({
        architectId: handshake.architectId,
        companyRecordId: row.companyRecordId,
        rows: sheet.rows,
      });

      if (outcome.importedCount === 0) {
        // Step 7 said the rows were valid, so nothing stored means the store
        // itself failed — worth saying plainly, because it is a different
        // problem from bad data and needs a different person to look at it.
        mark(
          INGESTION_STEPS[8],
          false,
          `stored 0 of ${outcome.rowCount} valid rows: ` +
            (outcome.errors.map((e) => `row ${e.row}: ${e.error}`).slice(0, 5).join('; ') ||
              'nothing imported'),
        );
        await failRow(row.id, steps, {
          rowCount: outcome.rowCount,
          importedCount: 0,
          aqiData: sheet.rows as unknown as Prisma.InputJsonValue,
        });
        continue;
      }

      // The step is "store audit information", so it writes the audit trail as
      // well as the readings: who delivered what, from where, into which file.
      await prisma.auditLog.create({
        data: {
          userId: handshake.architectId,
          action: 'SFTP_INGEST',
          detail:
            `${row.companyId} ${row.fileName}: stored ${outcome.importedCount}/${outcome.rowCount} readings ` +
            `from ${row.relativePath}`,
          ip: row.sourceIp,
        },
      }).catch(() => undefined);

      mark(
        INGESTION_STEPS[8],
        true,
        `stored ${outcome.importedCount}/${outcome.rowCount}` +
          (outcome.failedCount ? `, ${outcome.failedCount} row errors` : '') +
          ', audit written',
      );

      // 10. Move to archive
      const archivePath = path.join(archiveRoot(), row.companyId, path.basename(row.relativePath));
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      await fs.rename(absolute, archivePath).catch(async () => {
        await fs.copyFile(absolute, archivePath);
        await fs.unlink(absolute);
      });
      mark(INGESTION_STEPS[9], true, `archived to ${path.relative(process.cwd(), archivePath)}`);

      const statusText = allCorrect(steps)
        ? ['CORRECT', ...steps.map((s) => `${s.step} — OK`)].join('\n')
        : formatFileStatus(steps);

      await prisma.dataFile.update({
        where: { id: row.id },
        data: {
          pollStatus: 'ARCHIVED',
          fileStatus: statusText,
          rowCount: outcome.rowCount,
          importedCount: outcome.importedCount,
          aqiData: sheet.rows as unknown as Prisma.InputJsonValue,
          relativePath: `archive/${row.companyId}/${path.basename(row.relativePath)}`,
        },
      });

      if (row.uploadId) {
        await prisma.sftpUpload.update({
          where: { id: row.uploadId },
          data: {
            status: outcome.failedCount > 0 ? 'PARTIAL' : 'PARSED',
            validationPassed: true,
            rowCount: outcome.rowCount,
            importedCount: outcome.importedCount,
            failedCount: outcome.failedCount,
            columns: sheet.columns as unknown as Prisma.InputJsonValue,
            rows: sheet.rows as unknown as Prisma.InputJsonValue,
            errors: outcome.errors as unknown as Prisma.InputJsonValue,
            parsedAt: new Date(),
          },
        });
      }

      processed += 1;
    } catch (error) {
      errors.push(`${row.fileName}: ${error instanceof Error ? error.message : String(error)}`);
      await prisma.dataFile.update({
        where: { id: row.id },
        data: {
          pollStatus: 'FAILED',
          fileStatus: `FAILED — ${error instanceof Error ? error.message : String(error)}`,
        },
      }).catch(() => undefined);
    }
  }

  return { processed, errors };
}

async function failRow(
  id: string,
  steps: IngestionStepResult[],
  extra?: { rowCount?: number; importedCount?: number; aqiData?: Prisma.InputJsonValue },
) {
  await prisma.dataFile.update({
    where: { id },
    data: {
      pollStatus: 'FAILED',
      fileStatus: formatFileStatus(steps),
      rowCount: extra?.rowCount ?? 0,
      importedCount: extra?.importedCount ?? 0,
      aqiData: extra?.aqiData,
    },
  });
}

export async function runBothPolls() {
  const poll1 = await runPoll1();
  const poll2 = await runPoll2();
  return { poll1, poll2 };
}
