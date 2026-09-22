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
 * (`siteName_dd_mm_yyyy_hh-mm-ss[_lat_lon]_AQI.csv`) into intake. Folder
 * creation and database work live here.
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

/**
 * The name the Windows agent always sends:
 *
 *   ABCD123_21_09_2026_11-30-24_AQI.csv
 *   ABCD123_21_09_2026_11-30-24_19.033_73.0297_AQI.csv
 *
 * Site name, date as dd_mm_yyyy, time as hh-mm-ss, then optional latitude and
 * longitude stamped at install. It arrives flat because the agent may not
 * create folders; poll1 takes it apart and builds the tree.
 *
 * The site name is matched non-greedily up to the date, so an id that itself
 * contains underscores still parses. Coordinates are optional so older agents
 * without a location step still validate.
 */
const AQI_FILE_RE =
  /^(.+?)_(\d{2})_(\d{2})_(\d{4})_(\d{2})-(\d{2})-(\d{2})(?:_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?))?_AQI\.(csv|xlsx)$/i;

export type ParsedAqiFileName = {
  siteName: string;
  /** dd_mm_yyyy — the folder CIDCO files the day under. */
  dateFolder: string;
  /** hh-mm-ss — the name CIDCO gives the file itself. */
  timeStem: string;
  /** dd_mm_yyyy_hh-mm-ss, the two joined: one delivery, identified. */
  timestamp: string;
  /**
   * Decimal degrees when the agent stamped them, and only when they name a
   * real place — null otherwise, so a reading is never filed at a point past
   * the poles or the date line.
   */
  latitude: number | null;
  longitude: number | null;
  extension: string;
  at: Date;
};

export function parseAqiFileName(fileName: string): ParsedAqiFileName | null {
  const base = path.basename(fileName);
  const match = AQI_FILE_RE.exec(base);
  if (!match) return null;

  const [, siteName, dd, mm, yyyy, hh, mi, ss, latitude, longitude, extension] = match;
  const at = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));

  // A name can be well-formed and still be nonsense — 32_13_2026 matches the
  // pattern. Date rolls such a value over silently, so compare it back.
  if (
    at.getFullYear() !== Number(yyyy) || at.getMonth() !== Number(mm) - 1 || at.getDate() !== Number(dd) ||
    at.getHours() !== Number(hh) || at.getMinutes() !== Number(mi) || at.getSeconds() !== Number(ss)
  ) {
    return null;
  }

  const dateFolder = `${dd}_${mm}_${yyyy}`;
  const timeStem = `${hh}-${mi}-${ss}`;
  return {
    siteName,
    dateFolder,
    timeStem,
    timestamp: `${dateFolder}_${timeStem}`,
    ...coordinatesOf(latitude, longitude),
    extension: extension.toLowerCase(),
    at,
  };
}

/** Reads the stamped pair, keeping it only when it is somewhere on Earth. */
function coordinatesOf(lat?: string, lon?: string) {
  const none = { latitude: null, longitude: null };
  if (lat === undefined || lon === undefined) return none;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return none;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return none;
  return { latitude, longitude };
}

const pathExists = (p: string) => fs.stat(p).then(() => true, () => false);

export function inboxRoot() {
  return path.resolve(process.env.CIDCO_INBOX_DIR || './storage/inbox');
}

export function archiveRoot() {
  return path.resolve(process.env.CIDCO_ARCHIVE_DIR || './storage/archive');
}

/** The folder columns on the data row, derived from a parsed name. */
export function folderPartsFromStamp(parsed: ParsedAqiFileName) {
  return {
    /** Kept as an index so a month can be listed without scanning days. */
    monthFolder: monthFolderFor(parsed.at),
    dateFolder: parsed.dateFolder,
    timestampFolder: parsed.timeStem,
    at: parsed.at,
  };
}

/**
 * Where poll1 files a CSV:
 *
 *   <dataRoot>/<siteName>/<dd_mm_yyyy>/<hh-mm-ss>.csv
 *
 * The delivery time names the file, so the flat name the agent sent is not
 * kept — the company is the folder above the date, and the date folder is the
 * day. `suffix` distinguishes a second delivery landing on the same second,
 * which would otherwise overwrite the first before poll2 ever saw it.
 */
export function pollTreeLocation(
  siteName: string,
  fileName: string,
  parsed: ParsedAqiFileName,
  suffix = 0,
) {
  const company = safeFolder(siteName);
  const { monthFolder, dateFolder, timestampFolder } = folderPartsFromStamp(parsed);
  const extension = parsed.extension === 'xlsx' ? 'xlsx' : 'csv';
  const leaf = `${parsed.timeStem}${suffix > 0 ? `_${suffix + 1}` : ''}.${extension}`;
  const relativePath = `${company}/${dateFolder}/${leaf}`;

  return {
    monthFolder,
    dateFolder,
    timestampFolder,
    leaf,
    relativePath,
    absolutePath: path.join(dataRoot(), company, dateFolder, leaf),
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
    if (!result.ok) return `${step} — FAILED: ${result.detail}`;
    // A passing step carries its detail too — "7/10 rows valid, 3 rejected" is
    // a pass, and it is also the only line that says what was lost.
    return `${step} — OK${result.detail ? `: ${result.detail}` : ''}`;
  }).join('\n');
}

function allCorrect(steps: IngestionStepResult[]): boolean {
  return steps.every((s) => s.ok);
}

/** Drop a received transfer into the inbox for poll1. Does not create the data tree. */
export async function enqueueInboxFile(params: {
  fileName: string;
  buffer: Buffer;
  presentedPath: string | null;
  mode: 'DIRECT_SFTP' | 'PORTAL';
  company: Company | null;
  handshakeId: string;
}) {
  const { fileName, buffer, presentedPath, mode, company, handshakeId } = params;
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
      mode,
      presentedSiteName: parsed?.siteName ?? company?.siteName ?? null,
      presentedPath,
      siteNameMatch: Boolean(company && parsed && company.siteName === parsed.siteName),
      pathMatch: !presentedPath || !company?.designatedPath,
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
        siteName: company.siteName,
        monthFolder: parsed ? folderPartsFromStamp(parsed).monthFolder : 'pending',
        dateFolder: parsed?.dateFolder ?? 'pending',
        timestampFolder: parsed?.timeStem ?? 'pending',
        timestamp: parsed?.timestamp ?? null,
        latitude: parsed?.latitude ?? null,
        longitude: parsed?.longitude ?? null,
        relativePath: `inbox/${inboxName}`,
        fileName: inboxName,
        deliveredName: inboxName,
        sizeBytes: buffer.length,
        rowCount: 0,
        importedCount: 0,
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
 * Poll 1 — fetch siteName + timestamp from the filename, ensure
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
        errors.push(`${entry.name}: filename must be siteName_dd_mm_yyyy_hh-mm-ss[_lat_lon]_AQI.csv`);
        continue;
      }

      let company = await prisma.company.findUnique({ where: { siteName: parsed.siteName } });
      // Even without a registration, still file under the site name from the name.
      if (!company) {
        const owner = await sharedLoginHandshake();
        company = await prisma.company.create({
          data: {
            siteName: parsed.siteName,
            designatedPath: '',
            userId: owner?.architectId ?? null,
            active: true,
            notes: 'Auto-created by poll1 from inbound filename (no prior registration)',
          },
        });
      }

      // The delivery time names the file, so two deliveries in the same second
      // would land on the same name and the second would destroy the first
      // before poll2 ever read it. Step back to a free name instead; poll2's
      // duplicate check then reports it properly rather than data going quiet.
      let where = pollTreeLocation(parsed.siteName, entry.name, parsed);
      for (let n = 1; n < 100 && (await pathExists(where.absolutePath)); n++) {
        where = pollTreeLocation(parsed.siteName, entry.name, parsed, n);
      }
      if (await pathExists(where.absolutePath)) {
        errors.push(`${entry.name}: ${where.relativePath} and 99 alternatives all exist`);
        continue;
      }

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
            siteName: company.siteName,
            monthFolder: where.monthFolder,
            dateFolder: where.dateFolder,
            timestampFolder: where.timestampFolder,
            timestamp: parsed.timestamp,
            // Where the station stands, as the agent stamped it.
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            relativePath: where.relativePath,
            fileName: where.leaf,
            deliveredName: entry.name,
            sizeBytes: (await fs.stat(where.absolutePath)).size,
            pollStatus: 'FILED',
            fileStatus: [
              `${INGESTION_STEPS[0]} — OK`,
              `Filed ${entry.name} at ${where.relativePath} (poll1)`,
            ].join('\n'),
          },
        });
      } else {
        await prisma.dataFile.create({
          data: {
            companyRecordId: company.id,
            siteName: company.siteName,
            monthFolder: where.monthFolder,
            dateFolder: where.dateFolder,
            timestampFolder: where.timestampFolder,
            timestamp: parsed.timestamp,
            // Where the station stands, as the agent stamped it.
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            relativePath: where.relativePath,
            fileName: where.leaf,
            deliveredName: entry.name,
            sizeBytes: (await fs.stat(where.absolutePath)).size,
            pollStatus: 'FILED',
            fileStatus: [
              `${INGESTION_STEPS[0]} — OK`,
              `Filed ${entry.name} at ${where.relativePath} (poll1)`,
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
      //
      // The filed name is the delivery time — "11-30-24.csv" — so it no
      // longer carries the company. What is validated is the name the agent
      // actually sent, plus the tree poll1 filed it into: company folder,
      // date folder, and a leaf that matches the time in the name. Checking
      // the whole path is a stronger check than the old leaf-only one.
      const parsed = parseAqiFileName(row.deliveredName ?? '');
      if (!parsed) {
        mark(
          INGESTION_STEPS[3],
          false,
          `delivered as "${row.deliveredName ?? '(not recorded)'}" — ` +
            'expected siteName_dd_mm_yyyy_hh-mm-ss[_lat_lon]_AQI.csv',
        );
        await failRow(row.id, steps);
        continue;
      }
      if (parsed.siteName !== row.siteName) {
        mark(INGESTION_STEPS[3], false, `filename company ${parsed.siteName} ≠ row ${row.siteName}`);
        await failRow(row.id, steps);
        continue;
      }
      if (!row.relativePath.startsWith(`${row.siteName}/${parsed.dateFolder}/`)) {
        mark(
          INGESTION_STEPS[3],
          false,
          `filed at ${row.relativePath}, but the name says ${row.siteName}/${parsed.dateFolder}/`,
        );
        await failRow(row.id, steps);
        continue;
      }
      if (!row.fileName.startsWith(parsed.timeStem)) {
        mark(INGESTION_STEPS[3], false, `filed as ${row.fileName}, but the name says ${parsed.timeStem}`);
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[3], true, `${row.deliveredName} → ${row.relativePath}`);

      // 5. Project/Site (company registration)
      if (!row.company || !row.company.active) {
        mark(INGESTION_STEPS[4], false, 'company inactive or missing');
        await failRow(row.id, steps);
        continue;
      }
      mark(INGESTION_STEPS[4], true, row.company.siteName);

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
              siteName: row.siteName,
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
            `${row.siteName} ${row.fileName}: stored ${outcome.importedCount}/${outcome.rowCount} readings ` +
            `from ${row.relativePath}`,
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
      // The date folder comes along. Without it every day's "11-30-24.csv"
      // would land on the same archive path and overwrite the day before.
      const archivePath = path.join(
        archiveRoot(), row.siteName, row.dateFolder, path.basename(row.relativePath),
      );
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      await fs.rename(absolute, archivePath).catch(async () => {
        await fs.copyFile(absolute, archivePath);
        await fs.unlink(absolute);
      });
      mark(INGESTION_STEPS[9], true, `archived to ${path.relative(process.cwd(), archivePath)}`);

      // A file can clear all ten steps and still have lost rows: step 7 keeps
      // a file alive as long as *some* row is valid. Saying CORRECT there
      // would report a file that quietly dropped three readings as perfect,
      // which is the one thing the file status exists to prevent.
      const rejected = outcome.rowCount - outcome.importedCount;
      const headline = !allCorrect(steps)
        ? null
        : rejected > 0
          ? `CORRECT WITH REJECTED ROWS — ${outcome.importedCount} of ${outcome.rowCount} stored, ` +
            `${rejected} rejected`
          : 'CORRECT';

      // The per-step details are kept either way. Flattening them to "OK" threw
      // away the very line that said which rows went missing.
      const statusText = headline
        ? [headline, formatFileStatus(steps)].join('\n')
        : formatFileStatus(steps);

      await prisma.dataFile.update({
        where: { id: row.id },
        data: {
          pollStatus: 'ARCHIVED',
          fileStatus: statusText,
          rowCount: outcome.rowCount,
          importedCount: outcome.importedCount,
          aqiData: sheet.rows as unknown as Prisma.InputJsonValue,
          relativePath: `archive/${row.siteName}/${row.dateFolder}/${path.basename(row.relativePath)}`,
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
  await recordHeartbeat({ moved: poll1.moved, processed: poll2.processed });
  return { poll1, poll2 };
}

// --- is the poll worker actually running? ---------------------------------
//
// Nothing in the portal used to know. Stop the worker — close the terminal it
// was started in — and files pile up in the inbox while the portal shows the
// last thing it ingested, with no hint that anything is wrong. The failure is
// invisible exactly when it matters, so the worker now leaves a mark each
// tick and the portal reads it.

const HEARTBEAT_FILE = '.poll-heartbeat';

function heartbeatPath() {
  return path.join(dataRoot(), HEARTBEAT_FILE);
}

async function recordHeartbeat(counts: { moved: number; processed: number }) {
  try {
    await fs.mkdir(dataRoot(), { recursive: true });
    await fs.writeFile(
      heartbeatPath(),
      JSON.stringify({ at: new Date().toISOString(), ...counts }),
    );
  } catch {
    // A heartbeat that cannot be written must not stop the ingestion that
    // just succeeded.
  }
}

export type IngestionHealth = {
  /** When the worker last finished a tick, if it has ever written one. */
  lastRunAt: string | null;
  secondsSinceLastRun: number | null;
  /** Files sitting in the inbox right now, waiting to be filed. */
  waiting: number;
  /** The configured tick, so "overdue" means something. */
  intervalMs: number;
  /**
   * The worker looks stopped: it has not ticked in several intervals, or it
   * has never ticked at all while files are waiting.
   */
  stalled: boolean;
  inboxDir: string;
};

export async function ingestionHealth(): Promise<IngestionHealth> {
  const intervalMs = Number(process.env.POLL_INTERVAL_MS || 15_000);

  let waiting = 0;
  try {
    const entries = await fs.readdir(inboxRoot(), { withFileTypes: true });
    waiting = entries.filter((e) => e.isFile() && isAcceptedFile(e.name)).length;
  } catch {
    // No inbox yet is not a fault; nothing has been delivered.
  }

  let lastRunAt: string | null = null;
  try {
    const raw = JSON.parse(await fs.readFile(heartbeatPath(), 'utf8')) as { at?: string };
    if (raw.at && !Number.isNaN(Date.parse(raw.at))) lastRunAt = raw.at;
  } catch {
    // Never run, or the file is unreadable — both mean "no recent tick".
  }

  const secondsSinceLastRun =
    lastRunAt === null ? null : Math.max(0, Math.round((Date.now() - Date.parse(lastRunAt)) / 1000));

  // Several intervals, not one: a slow tick on a big file is not a fault.
  const overdueAfter = Math.max(60, (intervalMs / 1000) * 4);
  const stalled =
    secondsSinceLastRun === null ? waiting > 0 : secondsSinceLastRun > overdueAfter;

  return { lastRunAt, secondsSinceLastRun, waiting, intervalMs, stalled, inboxDir: inboxRoot() };
}
