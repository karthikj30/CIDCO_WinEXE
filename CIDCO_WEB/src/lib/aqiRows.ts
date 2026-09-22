import type { DataFile } from '@prisma/client';

/**
 * Turning a stored file back into readings a person can look at.
 *
 * `DataFile.aqiData` holds the sheet exactly as it was parsed — before
 * validation, so rows CIDCO rejected are in there too. That is deliberate:
 * a reading that was thrown away for a missing AQI value is precisely the one
 * an officer needs to see, and a table built only from what was stored would
 * quietly hide it.
 */

/**
 * The AQI parameters shown as columns, in the order CIDCO publishes them.
 *
 * `required` marks the two a reading cannot be stored without. A blank
 * anywhere else is a gap in the data; a blank in these two means the row
 * never became a reading at all, and the table says so differently.
 */
export const AQI_PARAMETERS = [
  { key: 'projectSiteId', label: 'Project / Site', required: false, numeric: false },
  { key: 'monitoringStationId', label: 'Station', required: false, numeric: false },
  // CIDCO publishes these as one column, "OEM / Model", and the alias map
  // folds that spelling onto `oem`. Listing Model separately would report a
  // gap on every reading ever sent, which is the fastest way to teach an
  // officer to stop reading this column.
  { key: 'oemModel', label: 'OEM / Model', required: false, numeric: false },
  { key: 'measuredAt', label: 'Date & Time', required: true, numeric: false },
  { key: 'aqiValue', label: 'AQI', required: true, numeric: true },
  { key: 'pm25', label: 'PM2.5', required: false, numeric: true },
  { key: 'pm10', label: 'PM10', required: false, numeric: true },
  { key: 'no2', label: 'NO₂', required: false, numeric: true },
  { key: 'so2', label: 'SO₂', required: false, numeric: true },
  { key: 'co', label: 'CO', required: false, numeric: true },
  { key: 'ozone', label: 'O₃', required: false, numeric: true },
  { key: 'temperature', label: 'Temp °C', required: false, numeric: true },
  { key: 'humidity', label: 'Humidity %', required: false, numeric: true },
  { key: 'otherParams', label: 'Other', required: false, numeric: false },
  { key: 'integrationMethod', label: 'Source', required: false, numeric: false },
] as const;

export type AqiParameterKey = (typeof AQI_PARAMETERS)[number]['key'];

export type AqiReadingRow = {
  /** Stable enough for a React key: the file plus the row's place in it. */
  id: string;
  fileId: string;
  /** The name in the tree, e.g. 11-30-24.csv */
  fileName: string;
  /** The flat name the agent delivered it under. */
  deliveredName: string | null;
  siteName: string;
  dateFolder: string;
  /** 1-based row number in the sheet, counting the header as row 1. */
  sheetRow: number;
  values: Record<string, string | null>;
  /** Parameter keys with no value in this row. */
  missing: AqiParameterKey[];
  /** Whether a missing value is one of the two that stop the row being stored. */
  missingRequired: boolean;
};

/**
 * A cell counts as missing when it is absent, null, or blank once trimmed.
 *
 * A CSV has no way to say "null" — it says "". Treating "" as a value would
 * make every gap look like data, which is the whole thing this view exists to
 * show.
 */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function asText(value: unknown): string | null {
  if (isBlank(value)) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

/** "Aeroqual / AQY-1", or whichever half was given, or nothing. */
function joined(oem: string | null, model: string | null): string | null {
  if (oem && model) return `${oem} / ${model}`;
  return oem ?? model;
}

/** Flattens one stored file into its readings. */
export function readingsOf(file: DataFile): AqiReadingRow[] {
  const sheet = file.aqiData;
  if (!Array.isArray(sheet)) return [];

  return sheet.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const values: Record<string, string | null> = {};
    const missing: AqiParameterKey[] = [];

    for (const parameter of AQI_PARAMETERS) {
      const text =
        parameter.key === 'oemModel'
          ? joined(asText(row.oem), asText(row.deviceModel))
          : asText(row[parameter.key]);
      values[parameter.key] = text;
      if (text === null) missing.push(parameter.key);
    }

    return {
      id: `${file.id}:${index}`,
      fileId: file.id,
      fileName: file.fileName,
      deliveredName: file.deliveredName,
      siteName: file.siteName,
      dateFolder: file.dateFolder,
      // +2: sheet rows are 1-based and row 1 is the header — the same
      // numbering the ingestion service uses when it names a rejected row.
      sheetRow: index + 2,
      values,
      missing,
      missingRequired: AQI_PARAMETERS.some((p) => p.required && missing.includes(p.key)),
    };
  });
}
