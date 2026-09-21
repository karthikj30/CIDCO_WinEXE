#!/usr/bin/env node
/**
 * Generates the sample AQI exports used to test the whole chain end to end:
 * the agent renaming whatever it is handed, poll1 filing it, poll2 reading it
 * into the database, and blank cells showing as missing on the portal.
 *
 *   node tools/make-test-csvs.mjs [outDir]
 *
 * Defaults to architect_WINexe/sample/testdata. Deterministic: the same files
 * come out every run, so a diff means the generator changed, not the dice.
 *
 * The names are deliberately all over the place — spaces, brackets, capitals,
 * dots, dates — because the agent must take any .csv name and rename it to
 * companyId_dd_mm_yyyy_hh-mm-ss_AQI.csv on the way out. If a name only ever
 * worked because it looked tidy, these files are what finds that out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.join(here, '..', 'architect_WINexe', 'sample', 'testdata');

/** CIDCO's published columns, spelled the way the published sheet spells them. */
const COLUMNS = [
  'Project / Site ID',
  'AQI Monitoring Station / Device ID',
  'OEM / Model',
  'Date & Time of Reading',
  'AQI Value',
  'PM2.5',
  'PM10',
  'NO₂',
  'SO₂',
  'CO',
  'O₃',
  'Temperature',
  'Humidity',
  'Other applicable environmental parameters',
  'Data Source / Integration Method',
  'Data Receipt Timestamp',
];

/** Keys in the same order, so a blank list can name a column plainly. */
const KEYS = [
  'site', 'station', 'oem', 'measuredAt', 'aqi', 'pm25', 'pm10',
  'no2', 'so2', 'co', 'o3', 'temperature', 'humidity', 'other',
  'source', 'receipt',
];

/** A small deterministic PRNG, so the files never shift between runs. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const SITES = [
  ['CIDCO-KHR-012', 'STN-KHR-07', 'Aeroqual AQY-1', 'Kharghar Sector 12'],
  ['CIDCO-PNV-004', 'STN-PNV-02', 'Envirotech APM-550', 'Panvel Node 4'],
  ['CIDCO-NER-021', 'STN-NER-11', 'Oizom Polludrone', 'Nerul Sector 21'],
  ['CIDCO-ULW-008', 'STN-ULW-03', 'Prana Air Sensible+', 'Ulwe Node 8'],
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;

function csvCell(v) {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One file.
 *
 * `blank` names the columns to leave empty; `blankRows` limits that to certain
 * row numbers, so a file can be mostly good with a few gaps — which is how a
 * real export goes wrong, rather than a whole column vanishing at once.
 */
function makeFile({ name, rows, seed, blank = [], blankRows = null, note }) {
  const rand = rng(seed);
  const [site, station, oem, siteName] = SITES[seed % SITES.length];
  const start = Date.UTC(2026, 8, 21, 0, 0, 0); // 21 September 2026

  const lines = [COLUMNS.map(csvCell).join(',')];

  for (let i = 0; i < rows; i++) {
    const at = new Date(start + i * 3600_000);
    const aqi = Math.round(80 + rand() * 180);
    const n = (base, spread, dp = 1) => (base + rand() * spread).toFixed(dp);

    const values = {
      site,
      station,
      oem,
      measuredAt: iso(at),
      aqi: String(aqi),
      pm25: n(30, 90),
      pm10: n(60, 140),
      no2: n(10, 45),
      so2: n(4, 20),
      co: n(0.2, 1.4, 2),
      o3: n(15, 60),
      temperature: n(24, 14),
      humidity: n(45, 35),
      other: `noise=${Math.round(52 + rand() * 18)} dB; wind=${n(0.5, 4)} m/s`,
      source: 'SFTP automatic upload',
      receipt: iso(new Date(at.getTime() + 11_000)),
    };

    const rowIsBlanked = blankRows === null || blankRows.includes(i);
    if (rowIsBlanked) for (const key of blank) values[key] = '';

    lines.push(KEYS.map((k) => csvCell(values[k])).join(','));
  }

  fs.writeFileSync(path.join(outDir, name), lines.join('\n') + '\n');
  return { name, rows, note };
}

// Every file carries all sixteen columns. What varies is which cells are empty
// — a missing column and a missing value are different failures, and only the
// second is what an architect's export actually does.
const FILES = [
  { name: 'readings.csv', rows: 12, seed: 1,
    note: 'complete — the baseline every other file is compared against' },

  { name: 'Sept Export (2).csv', rows: 10, seed: 2,
    note: 'complete; spaces and brackets in the name' },

  { name: 'aqi.daily.2026.csv', rows: 11, seed: 3,
    note: 'complete; dots in the name, so only the last one is the extension' },

  { name: 'AQI-2026-09-21.csv', rows: 10, seed: 4,
    note: 'complete; a name that already looks like a date' },

  { name: 'station-KHR-07_dump.csv', rows: 12, seed: 5,
    blank: ['o3', 'temperature'], blankRows: [2, 5, 6, 9],
    note: 'O₃ and Temperature missing on 4 of 12 rows — stored as null' },

  { name: 'MONITORING DATA FINAL.csv', rows: 10, seed: 6,
    blank: ['humidity'],
    note: 'Humidity blank on every row — a whole parameter never recorded' },

  { name: 'export_20260921.csv', rows: 13, seed: 7,
    blank: ['pm25', 'so2', 'co'], blankRows: [0, 3, 4, 8, 11],
    note: 'PM2.5, SO₂ and CO missing on scattered rows' },

  { name: 'kharghar site readings.csv', rows: 10, seed: 8,
    blank: ['oem', 'other'],
    note: 'text parameters blank — OEM / Model and Other parameters' },

  { name: 'Book1.csv', rows: 10, seed: 9,
    blank: ['pm10', 'no2', 'so2', 'co', 'o3', 'temperature', 'humidity', 'other'],
    blankRows: [1, 2, 4, 7, 8],
    note: 'sparse — half the rows carry almost nothing but AQI and the time' },

  { name: 'panvel_node_feed.csv', rows: 14, seed: 10,
    blank: ['site', 'station'], blankRows: [3, 9],
    note: 'Project / Site ID and Station ID blank on 2 rows' },

  { name: 'partial_upload.csv', rows: 11, seed: 11,
    blank: ['aqi'], blankRows: [1, 5, 8],
    note: 'AQI Value (required) blank on 3 rows — those rows rejected, 8 stored' },

  { name: 'no_reading_times.csv', rows: 10, seed: 12,
    blank: ['measuredAt'],
    note: 'Date & Time (required) blank on every row — whole file fails step 7' },
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const made = FILES.map(makeFile);

const readme = [
  '# Test exports',
  '',
  'Generated by `node tools/make-test-csvs.mjs` — deterministic, so regenerating',
  'them produces no diff unless the generator changed.',
  '',
  'These stand in for what an architect\'s monitoring software drops into the',
  'export folder. The names are deliberately inconsistent: the agent has to take',
  'any `.csv` name and rename it to `companyId_dd_mm_yyyy_hh-mm-ss_AQI.csv` on',
  'the way out, so a name that only worked because it was tidy would pass',
  'unnoticed without these.',
  '',
  'Every file carries all sixteen published columns. What varies is which cells',
  'are empty — a missing column and a missing value fail differently, and only',
  'the second is what a real export does.',
  '',
  '| File | Rows | What it is for |',
  '| --- | --- | --- |',
  ...made.map((f) => `| \`${f.name}\` | ${f.rows} | ${f.note} |`),
  '',
  '## What to expect',
  '',
  'Blank **optional** parameters are stored as null and show as `—` in the',
  'portal\'s data table. Blank **required** ones — AQI Value and Date & Time of',
  'Reading — are not: the row is rejected at step 7 (Validate data), and the',
  'file status names the row and the reason.',
  '',
  '`partial_upload.csv` and `no_reading_times.csv` are the two that are supposed',
  'to fail. Everything else should read `CORRECT`.',
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'README.md'), readme);

console.log(`${made.length} files written to ${outDir}`);
for (const f of made) console.log(`  ${f.name.padEnd(30)} ${String(f.rows).padStart(2)} rows  ${f.note}`);
