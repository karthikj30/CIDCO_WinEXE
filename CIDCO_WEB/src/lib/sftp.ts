import { createHash, timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { ArchitectHandshake, Company, Prisma, TransferMode } from '@prisma/client';
import { prisma } from './prisma';
import { createReport } from './reports';
import { normaliseReadingFields, reportSchema } from './validation';

/**
 * The SFTP delivery channel.
 *
 * CIDCO registers the company by hand first — company name, company id, the
 * architect's server address and the file path their CSV is taken from — and
 * only then issues an SFTP user id and password against that record, emailing
 * it with the designated address to send to.
 *
 * From then on the architect sends automatically. **Every single transfer is
 * validated on the CIDCO side**: the company id, the address it arrived from
 * and the path it was taken from are compared against what CIDCO registered.
 * Only when all three match is the file parsed and its readings stored.
 */

// --- Workbook shape --------------------------------------------------------

/** The columns CIDCO expects in the uploaded sheet, in order. */
export const SHEET_COLUMNS: Array<{ header: string; key: string; width: number; example: string | number }> = [
  { header: 'Project / Site ID', key: 'projectSiteId', width: 20, example: 'CIDCO-KHR-012' },
  { header: 'Monitoring Station / Device ID', key: 'monitoringStationId', width: 28, example: 'STN-KHR-07' },
  { header: 'OEM', key: 'oem', width: 16, example: 'Aeroqual' },
  { header: 'Model', key: 'deviceModel', width: 14, example: 'AQY-1' },
  { header: 'Site Name', key: 'siteName', width: 26, example: 'Kharghar Sector 12 Site' },
  { header: 'Location', key: 'location', width: 26, example: 'Kharghar, Navi Mumbai' },
  { header: 'Date & Time of Reading', key: 'measuredAt', width: 22, example: '2026-09-11T06:00:00Z' },
  { header: 'AQI Value', key: 'aqiValue', width: 11, example: 176 },
  { header: 'PM2.5', key: 'pm25', width: 10, example: 78.3 },
  { header: 'PM10', key: 'pm10', width: 10, example: 152.9 },
  { header: 'NO2', key: 'no2', width: 10, example: 41.2 },
  { header: 'SO2', key: 'so2', width: 10, example: 12.7 },
  { header: 'CO', key: 'co', width: 10, example: 0.9 },
  { header: 'O3', key: 'ozone', width: 10, example: 48.6 },
  { header: 'Temperature', key: 'temperature', width: 13, example: 33.4 },
  { header: 'Humidity', key: 'humidity', width: 11, example: 62.1 },
  { header: 'Other Parameters', key: 'otherParams', width: 26, example: 'noise=61 dB; wind=3.2 m/s' },
  { header: 'Data Source / Integration Method', key: 'integrationMethod', width: 30, example: 'SFTP Excel upload' },
];

/** Header spellings an architect might realistically type, mapped to our keys. */
const HEADER_ALIASES: Record<string, string> = {
  'project id': 'projectSiteId',
  'site id': 'projectSiteId',
  'project/site id': 'projectSiteId',
  'station id': 'monitoringStationId',
  'device id': 'monitoringStationId',
  'aqi monitoring station/device id': 'monitoringStationId',
  'oem / model': 'oem',
  'oem/model': 'oem',
  model: 'deviceModel',
  'device model': 'deviceModel',
  site: 'siteName',
  'site name': 'siteName',
  address: 'location',
  date: 'measuredAt',
  'date & time of reading': 'measuredAt',
  'date and time of reading': 'measuredAt',
  'reading time': 'measuredAt',
  timestamp: 'measuredAt',
  aqi: 'aqiValue',
  'aqi value': 'aqiValue',
  'pm2.5': 'pm25',
  'pm 2.5': 'pm25',
  'pm2_5': 'pm25',
  'pm10': 'pm10',
  'pm 10': 'pm10',
  'no2': 'no2',
  'no₂': 'no2',
  'so2': 'so2',
  'so₂': 'so2',
  'o3': 'ozone',
  'o₃': 'ozone',
  ozone: 'ozone',
  'temperature (°c)': 'temperature',
  'temp': 'temperature',
  'humidity (%)': 'humidity',
  'rh': 'humidity',
  'other parameters': 'otherParams',
  'other applicable environmental parameters': 'otherParams',
  'data source': 'integrationMethod',
  'integration method': 'integrationMethod',
  'data source / integration method': 'integrationMethod',
};

/**
 * Reduces a header to its letters and digits, so every way of writing the same
 * column collapses onto one key: "AQI Monitoring Station / Device ID",
 * "aqi monitoring station/device id" and "AQI_Monitoring_Station_Device_ID" all
 * become "aqimonitoringstationdeviceid". Subscripts fold into digits so "NO₂"
 * and "NO2" agree.
 */
function headerSlug(raw: string) {
  return raw.toLowerCase().replace(/₂/g, '2').replace(/₃/g, '3').replace(/[^a-z0-9]/g, '');
}

/** Every known spelling, keyed by slug. Built once. */
const HEADER_BY_SLUG: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const column of SHEET_COLUMNS) {
    map[headerSlug(column.header)] = column.key;
    map[headerSlug(column.key)] = column.key;
  }
  // Aliases win over the template spellings they overlap with.
  for (const [spelling, key] of Object.entries(HEADER_ALIASES)) {
    map[headerSlug(spelling)] = key;
  }
  return map;
})();

function canonicalHeader(raw: string) {
  return HEADER_BY_SLUG[headerSlug(raw)] ?? raw.trim();
}

// --- Credentials -----------------------------------------------------------

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function hashesEqual(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Where a given architect's uploads land on CIDCO's disk. */
export function storageRoot() {
  return path.resolve(process.env.SFTP_STORAGE_DIR || './storage/sftp');
}

export function homeDirFor(clientId: string) {
  return path.join(storageRoot(), clientId.replace(/[^A-Za-z0-9_-]/g, '_'));
}

export const SFTP_PORT = Number(process.env.SFTP_PORT || 2222);

/**
 * The connection details CIDCO emails out. `designatedIp` is the address the
 * architect sends TO — not to be confused with the architect's own server
 * address, which CIDCO registers and validates every transfer against.
 */
export function sftpEndpoint(host?: string | null) {
  const designatedIp = process.env.SFTP_PUBLIC_HOST || host || 'localhost';
  return {
    designatedIp,
    host: designatedIp,
    port: SFTP_PORT,
    protocol: 'SFTP (SSH File Transfer Protocol)',
    fileTypes: '.csv (or .xlsx)',
  };
}

// --- Workbook parsing ------------------------------------------------------

/** A sheet column: the label as written, and the reading field it maps to. */
export type SheetColumn = { label: string; key: string };

export type ParsedSheet = {
  sheetName: string;
  /** In sheet order, so a preview table can line headers up with cells. */
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
};

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Formula cells, rich text and hyperlinks all carry their display value.
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return v.text;
    if ('richText' in v) return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
    if ('hyperlink' in v) return v.hyperlink;
    return String(value);
  }
  return value;
}

/**
 * Reads the first worksheet: row 1 is the header, every later non-empty row is
 * a reading. Both the raw header labels (for the CIDCO preview) and the
 * canonical keys (for the import) are returned.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('The workbook has no worksheets.');

  const headerRow = sheet.getRow(1);
  // Sparse by design: index i holds the column at spreadsheet position i+1.
  const byPosition: Array<SheetColumn | undefined> = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const label = String(cellValue(cell.value) ?? '').trim();
    if (!label) return;
    byPosition[col - 1] = { label, key: canonicalHeader(label) };
  });
  const columns = byPosition.filter((c): c is SheetColumn => !!c);
  if (columns.length === 0) {
    throw new Error('The first row of the sheet must be the column headers.');
  }

  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    let hasValue = false;
    for (let i = 0; i < byPosition.length; i++) {
      const column = byPosition[i];
      if (!column) continue;
      const value = cellValue(row.getCell(i + 1).value);
      if (value !== null && value !== '' && value !== undefined) hasValue = true;
      record[column.key] = value;
    }
    if (hasValue) rows.push(record);
  });

  return { sheetName: sheet.name, columns, rows };
}

/** Reads a CSV: row 1 is the header, every later row is a reading. */
export function parseCsv(buffer: Buffer): ParsedSheet {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });

  const labels = (parsed.meta.fields ?? []).map((f) => f.trim()).filter(Boolean);
  if (labels.length === 0) throw new Error('The first line of the CSV must be the column headers.');
  const columns: SheetColumn[] = labels.map((label) => ({ label, key: canonicalHeader(label) }));

  const rows = parsed.data
    .map((raw) => {
      const record: Record<string, unknown> = {};
      let hasValue = false;
      for (const label of labels) {
        const value = raw[label];
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (trimmed !== undefined && trimmed !== null && trimmed !== '') hasValue = true;
        record[canonicalHeader(label)] = trimmed ?? null;
      }
      return hasValue ? record : null;
    })
    .filter((r): r is Record<string, unknown> => r !== null);

  return { sheetName: 'CSV', columns, rows };
}

/** The file types the architect may send. CSV is the everyday one. */
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'] as const;

export function isAcceptedFile(fileName: string) {
  return ACCEPTED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
}

/** Parses whichever of the accepted formats arrived. */
export async function parseDataFile(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  if (fileName.toLowerCase().endsWith('.csv')) return parseCsv(buffer);
  return parseWorkbook(buffer);
}

// --- CIDCO-side transfer validation ----------------------------------------

/** What a transfer presented, to be checked against the company record. */
export type PresentedTransfer = {
  companyId: string | null;
  ip: string | null;
  filePath: string | null;
};

export type TransferValidation = {
  companyIdMatch: boolean;
  ipMatch: boolean;
  pathMatch: boolean;
  passed: boolean;
  reason: string | null;
  expected: { companyId: string; ip: string; filePath: string };
  presented: PresentedTransfer;
};

/** Trailing slashes and case should not decide whether a transfer is accepted. */
export function normalisePath(value: string | null | undefined) {
  if (!value) return '';
  const collapsed = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

/** A file path reduced to what two sides can agree on. */
export function comparablePath(value: string | null | undefined) {
  return normalisePath(value).replace(/^\/+/, '').toLowerCase();
}

export function normaliseIp(value: string | null | undefined) {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

/**
 * The check CIDCO runs on every transfer: does the company id, the address it
 * came from and (when registered) the path it was taken from match what CIDCO
 * registered for this company?
 *
 * Path is optional. When the company has no registered file path, or the
 * transfer did not declare one, pathMatch passes — poll1 still files the CSV
 * under company/month/date/timestamp from the filename alone.
 */
export function validateTransfer(company: Company, presented: PresentedTransfer): TransferValidation {
  const companyIdMatch = (presented.companyId ?? '').trim() === company.companyId;
  const ipMatch = normaliseIp(presented.ip) === normaliseIp(company.architectServerIp);
  const registeredPath = comparablePath(company.filePath);
  const presentedPath = comparablePath(presented.filePath);
  const pathMatch =
    registeredPath.length === 0 ||
    presentedPath.length === 0 ||
    presentedPath === registeredPath;
  const passed = companyIdMatch && ipMatch && pathMatch && company.active;

  const mismatches: string[] = [];
  if (!company.active) mismatches.push('the company registration is inactive');
  if (!companyIdMatch) {
    mismatches.push(`company id "${presented.companyId ?? '—'}" does not match the registered "${company.companyId}"`);
  }
  if (!ipMatch) {
    mismatches.push(`address ${presented.ip ?? '—'} is not the registered server address ${company.architectServerIp}`);
  }
  if (!pathMatch) {
    mismatches.push(`file path "${presented.filePath ?? '—'}" is not the registered path "${company.filePath}"`);
  }

  return {
    companyIdMatch,
    ipMatch,
    pathMatch,
    passed,
    reason: passed ? null : mismatches.join('; '),
    expected: {
      companyId: company.companyId,
      ip: company.architectServerIp,
      filePath: company.filePath,
    },
    presented,
  };
}

/** The blank workbook CIDCO hands the architect to fill in. */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CIDCO AQI Compliance Portal';
  wb.created = new Date();
  const sheet = wb.addWorksheet('AQI Data');

  sheet.columns = SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  sheet.getRow(1).border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // One worked example row so the expected formats are unambiguous.
  sheet.addRow(Object.fromEntries(SHEET_COLUMNS.map((c) => [c.key, c.example])));

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** The same columns as a CSV — the format the automated feed normally sends. */
export function buildCsvTemplate(): string {
  const header = SHEET_COLUMNS.map((c) => c.header).join(',');
  const example = SHEET_COLUMNS.map((c) => {
    const value = String(c.example);
    return value.includes(',') ? `"${value}"` : value;
  }).join(',');
  return `${header}\n${example}\n`;
}

// --- Import ----------------------------------------------------------------

export type ImportOutcome = {
  rowCount: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }>;
};

/**
 * Turns parsed sheet rows into reports. Every row is independent: a bad row is
 * recorded against its sheet row number and the rest still import, so one typo
 * never costs an architect the whole upload.
 */
export async function importRows(params: {
  architectId: string;
  /** The registered company the readings came from, for attribution. */
  companyRecordId?: string | null;
  rows: Array<Record<string, unknown>>;
}): Promise<ImportOutcome> {
  const { architectId, companyRecordId, rows } = params;
  const errors: Array<{ row: number; error: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    // +2: sheet rows are 1-based and row 1 is the header.
    const sheetRow = i + 2;
    try {
      const input = reportSchema.parse(prepareRow(rows[i]));
      await createReport({ userId: architectId, source: 'SFTP', input, companyRecordId });
      importedCount++;
    } catch (error) {
      errors.push({ row: sheetRow, error: describeError(error) });
    }
  }

  return { rowCount: rows.length, importedCount, failedCount: errors.length, errors };
}

/**
 * The columns a reading cannot be stored without. Everything else on the
 * CIDCO sheet is optional — a station that reports no ozone still reports an
 * AQI value, and a reading with no time is not a reading.
 */
export const REQUIRED_COLUMN_KEYS = ['measuredAt', 'aqiValue'] as const;

/**
 * Headers CIDCO publishes but does not store from the sheet.
 *
 * "Data Receipt Timestamp" is when CIDCO received the reading, so CIDCO sets
 * it — but it is on the published column list, so architects send it. Without
 * this it would be reported as an unrecognised header on every single file,
 * which trains people to ignore that line just when it matters.
 */
const IGNORED_HEADERS = new Set(['datareceipttimestamp', 'datareceiptts']);

export type ColumnCheck = {
  ok: boolean;
  /** Required AQI columns the header row does not carry. */
  missing: string[];
  /** Headers CIDCO does not recognise, kept for the officer to look at. */
  unrecognised: string[];
  /** How many of CIDCO's published columns were matched. */
  recognisedCount: number;
};

/**
 * Step 6 of the ingestion service, and the reason it exists.
 *
 * A header row of "foo,bar" parses perfectly well — it is a header row, it is
 * non-empty, and every row under it has values. Only comparing it against the
 * columns CIDCO published catches it, and catching it here rather than at the
 * store step is what lets the file status say "the columns are wrong" instead
 * of listing a validation error for every row in the file.
 */
export function validateColumns(columns: SheetColumn[]): ColumnCheck {
  const known = new Set(SHEET_COLUMNS.map((c) => c.key));
  const present = new Set(columns.map((c) => c.key));
  const isKnown = (c: SheetColumn) => known.has(c.key) || IGNORED_HEADERS.has(headerSlug(c.label));

  const missing = REQUIRED_COLUMN_KEYS.filter((key) => !present.has(key));
  const unrecognised = columns.filter((c) => !isKnown(c)).map((c) => c.label);
  const recognisedCount = columns.filter((c) => isKnown(c)).length;

  return { ok: missing.length === 0, missing, unrecognised, recognisedCount };
}

export type RowCheck = {
  ok: boolean;
  rowCount: number;
  validCount: number;
  errors: Array<{ row: number; error: string }>;
};

/**
 * Step 7: run every row past the same schema the store step uses, but write
 * nothing.
 *
 * Validating and storing in one pass would mean a file with one bad row in the
 * middle is half stored before the failure is known. Checking first keeps the
 * two questions apart: "is this data valid" is step 7, "did it go in" is step 9.
 */
export function validateRows(rows: Array<Record<string, unknown>>): RowCheck {
  const errors: Array<{ row: number; error: string }> = [];
  let validCount = 0;

  for (let i = 0; i < rows.length; i++) {
    try {
      reportSchema.parse(prepareRow(rows[i]));
      validCount++;
    } catch (error) {
      // +2: sheet rows are 1-based and row 1 is the header.
      errors.push({ row: i + 2, error: describeError(error) });
    }
  }

  return { ok: validCount > 0, rowCount: rows.length, validCount, errors };
}

/**
 * The defaults a sheet row is given before it is judged. Shared by the check
 * and the store so a row can never pass one and fail the other.
 */
function prepareRow(row: Record<string, unknown>) {
  const raw = normaliseReadingFields(row);
  if (!raw.siteName) raw.siteName = raw.projectSiteId || raw.monitoringStationId || 'Uploaded station';
  if (!raw.location) raw.location = raw.projectSiteId ? String(raw.projectSiteId) : 'N/A';
  if (!raw.integrationMethod) raw.integrationMethod = 'SFTP Excel upload';
  // A free-text "other parameters" cell is kept as a labelled note.
  if (typeof raw.otherParams === 'string' && raw.otherParams.trim()) {
    raw.otherParams = { note: raw.otherParams.trim() };
  }
  return raw;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Takes a delivered file: validates it against the company CIDCO registered,
 * and only if that passes parses it and stores the readings. Either way the
 * whole outcome — what was presented, what was expected, what matched — is
 * recorded for the CIDCO dashboard.
 *
 * Used by the SFTP server the moment a file handle closes, and by the portal
 * relay when an architect drags a file in.
 */
export async function ingestTransfer(params: {
  handshake: ArchitectHandshake;
  company: Company | null;
  fileName: string;
  storedName: string;
  buffer: Buffer;
  sourceIp: string | null;
  /** The path the file was taken from / written to, as presented. */
  presentedPath: string | null;
  mode: TransferMode;
}) {
  const { handshake, company, fileName, storedName, buffer, sourceIp, presentedPath, mode } = params;

  const presented: PresentedTransfer = {
    companyId: company?.companyId ?? null,
    ip: sourceIp,
    filePath: presentedPath,
  };

  // No company record means no reference to validate against — refuse it.
  const validation: TransferValidation = company
    ? validateTransfer(company, presented)
    : {
        companyIdMatch: false,
        ipMatch: false,
        pathMatch: false,
        passed: false,
        reason: 'These credentials are not linked to a registered company',
        expected: { companyId: '—', ip: '—', filePath: '—' },
        presented,
      };

  const upload = await prisma.sftpUpload.create({
    data: {
      handshakeId: handshake.id,
      fileName,
      storedName,
      sizeBytes: buffer.length,
      sourceIp,
      mode,
      presentedCompanyId: presented.companyId,
      presentedIp: presented.ip,
      presentedPath: presented.filePath,
      companyIdMatch: validation.companyIdMatch,
      ipMatch: validation.ipMatch,
      pathMatch: validation.pathMatch,
      validationPassed: validation.passed,
      status: 'RECEIVED',
    },
  });

  // Validation failed → nothing is parsed and nothing reaches the readings.
  if (!validation.passed) {
    return await prisma.sftpUpload.update({
      where: { id: upload.id },
      data: {
        status: 'REJECTED',
        rejectionReason: validation.reason,
        parsedAt: new Date(),
      },
    });
  }

  try {
    const sheet = await parseDataFile(buffer, fileName);
    const outcome = await importRows({
      architectId: handshake.architectId,
      companyRecordId: company?.id ?? null,
      rows: sheet.rows,
    });

    const status =
      outcome.importedCount === 0
        ? 'FAILED'
        : outcome.failedCount > 0
          ? 'PARTIAL'
          : 'PARSED';

    // File it in the data tree — <companyId>/<month>/<date>/<timestamp>/<file> —
    // and index that location in the data table. Prefer the poll pipeline for
    // new intakes; this path remains for older callers that still ingest inline.
    if (company) {
      try {
        const at = new Date();
        const where = dataTreeLocation(company.companyId, fileName, at);
        await fs.mkdir(path.dirname(where.absolutePath), { recursive: true });
        await fs.writeFile(where.absolutePath, buffer);
        await prisma.dataFile.create({
          data: {
            companyRecordId: company.id,
            companyId: company.companyId,
            monthFolder: where.monthFolder,
            dateFolder: where.dateFolder,
            timestampFolder: where.timestampFolder,
            timestamp: where.timestampFolder,
            relativePath: where.relativePath,
            fileName,
            sizeBytes: buffer.length,
            rowCount: outcome.rowCount,
            importedCount: outcome.importedCount,
            sourceIp,
            uploadId: upload.id,
            pollStatus: 'ARCHIVED',
            fileStatus: 'CORRECT\n(legacy inline ingest)',
            aqiData: sheet.rows as unknown as Prisma.InputJsonValue,
            receivedAt: at,
          },
        });
      } catch (error) {
        console.error('[sftp] could not file the CSV in the data tree', error);
      }
    }

    return await prisma.sftpUpload.update({
      where: { id: upload.id },
      data: {
        status,
        sheetName: sheet.sheetName,
        columns: sheet.columns as unknown as Prisma.InputJsonValue,
        // The sheet as delivered, so an officer can preview the original.
        rows: sheet.rows as unknown as Prisma.InputJsonValue,
        rowCount: outcome.rowCount,
        importedCount: outcome.importedCount,
        failedCount: outcome.failedCount,
        errors: outcome.errors as unknown as Prisma.InputJsonValue,
        parsedAt: new Date(),
      },
    });
  } catch (error) {
    return await prisma.sftpUpload.update({
      where: { id: upload.id },
      data: {
        status: 'FAILED',
        errors: [{ row: 0, error: describeError(error) }] as unknown as Prisma.InputJsonValue,
        parsedAt: new Date(),
      },
    });
  }
}

// --- The CIDCO data tree ---------------------------------------------------

/**
 * Where CIDCO files every accepted CSV after poll1:
 *
 *   <dataRoot>/<companyId>/<month>/<date>/<timestamp>/<file>.csv
 *
 * `companies` is the master table; `data_files` indexes this tree.
 */
export function dataRoot() {
  return path.resolve(process.env.CIDCO_DATA_DIR || './storage/cidco-data');
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Keeps a company id usable as a single folder name. */
export function safeFolder(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}

/** "2026-09-September" — the month folder. */
export function monthFolderFor(at: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${MONTHS[at.getMonth()]}`;
}

/** "2026-09-18" — the date folder. */
export function dateFolderFor(at: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/** "2026-09-18_11-30-05" — month, date and time (no weekday). */
export function timestampFolderFor(at: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}` +
    `_${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}`
  );
}

export type DataTreeLocation = {
  monthFolder: string;
  dateFolder: string;
  timestampFolder: string;
  relativePath: string;
  absolutePath: string;
};

/** Works out where one delivered file belongs in the tree. */
export function dataTreeLocation(companyId: string, fileName: string, at = new Date()): DataTreeLocation {
  const company = safeFolder(companyId);
  const monthFolder = monthFolderFor(at);
  const dateFolder = dateFolderFor(at);
  const timestampFolder = timestampFolderFor(at);
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

// --- The shared CIDCO SFTP login -------------------------------------------

/**
 * The Windows agent signs in with one CIDCO username and password and names
 * its company in the upload path, so a firm can run the agent without CIDCO
 * minting a separate SSH account for it.
 */
export const SHARED_SFTP_USER = process.env.SFTP_SHARED_USER || 'cidco@example.com';
export const SHARED_SFTP_PASSWORD = process.env.SFTP_SHARED_PASSWORD || '123456';

export function isSharedSftpLogin(username: string, password: string) {
  return username.trim().toLowerCase() === SHARED_SFTP_USER.toLowerCase() && password === SHARED_SFTP_PASSWORD;
}

/**
 * The agent writes to `/<companyId>/<the path the CSV was taken from>/<file>`,
 * which is how both the company and the source path reach CIDCO over a
 * protocol that carries nothing but a filename.
 */
export function parseAgentPath(remotePath: string): { companyId: string; declaredPath: string } | null {
  const clean = normalisePath(remotePath);
  const withoutLeading = clean.replace(/^\/+/, '');
  const dir = path.posix.dirname(`/${withoutLeading}`);
  const segments = dir.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const [companyId, ...rest] = segments;
  return { companyId, declaredPath: normalisePath(rest.join('/')) || '/' };
}

/**
 * The remote path the agent writes to, built in one place so the server and
 * the Windows agent cannot disagree about it:
 *
 *   /<companyId>/<file>
 *
 * e.g. "/ABCD123/ABCD123_21_09_2026_11-30-24_AQI.csv".
 *
 * It used to carry the folder the CSV was taken from as well, back when the
 * intake read the company and the source path out of the upload path. The file
 * name carries the company and the moment now, and poll1 builds the tree from
 * that, so the source folder did no work — and on an architect exporting from
 * a network share it produced "/ABCD123/192.168.1.100/common/karthik/…", a
 * path on nobody's server. `parseAgentPath` still reads either shape.
 */
export function agentRemotePath(companyId: string, fileName: string) {
  const company = companyId.trim().replace(/^\/+|\/+$/g, '');
  const name = path.posix.basename(fileName);
  return `/${[company, name].filter(Boolean).join('/')}`;
}

/**
 * The handshake row that carries transfers made with the shared CIDCO login.
 *
 * The Windows agent signs in as one CIDCO user for everybody and names its
 * company in the upload path, so there is no per-architect handshake to hang a
 * transfer off. This row is that hook: one carrier record, created on first
 * use, which every shared-login transfer is filed against. The company still
 * comes from what the agent presented, and is still validated in full.
 *
 * Both doors into the SFTP channel — the SFTP server and the portal's upload
 * endpoint — resolve it through here, so a credential that opens one opens the
 * other.
 */
export async function sharedLoginHandshake(): Promise<ArchitectHandshake | null> {
  const clientId = `shared:${SHARED_SFTP_USER}`;
  const found = await prisma.architectHandshake.findUnique({ where: { clientId } });
  if (found) return found;

  const owner = await prisma.user.findFirst({ where: { role: 'ARCHITECT' }, orderBy: { createdAt: 'asc' } });
  if (!owner) return null;

  return prisma.architectHandshake
    .create({
      data: {
        architectId: owner.id,
        channel: 'SFTP',
        clientId,
        secretHash: sha256(`carrier-${clientId}`),
        secretPrefix: 'shared',
        credentialExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        status: 'ESTABLISHED',
        establishedAt: new Date(),
      },
    })
    .catch(() => prisma.architectHandshake.findUnique({ where: { clientId } }));
}
