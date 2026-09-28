import type { AttachmentKind, ReportSource, ReportStatus } from '@prisma/client';
import { prisma } from './prisma';

/**
 * AQI readings live in three tables, one per way they reach CIDCO:
 *
 *   sftp_readings — delivered by the architect's Windows agent over SFTP
 *   api_readings  — posted to the CIDCO REST API against a handshake token
 *   reports       — entered by hand: the web form and CSV uploads
 *
 * The columns they share are identical, so everything in this module works the
 * same against any of them. A screen that shows one channel reads one table; a
 * screen that shows all of them reads every table and merges the rows here.
 */
export type ReadingChannel = 'SFTP' | 'API' | 'MANUAL';

export const READING_CHANNELS: ReadingChannel[] = ['SFTP', 'API', 'MANUAL'];

/** Which channel a `source` value belongs to. */
export const CHANNEL_OF_SOURCE: Record<ReportSource, ReadingChannel> = {
  SFTP: 'SFTP',
  API: 'API',
  WEB: 'MANUAL',
  CSV: 'MANUAL',
};

/** The reference-number prefix each channel issues under, so the three
 *  sequences run independently and can never hand out the same number. */
export const CHANNEL_REFERENCE_PREFIX: Record<ReadingChannel, string> = {
  SFTP: 'CIDCO/AQI/SFTP/',
  API: 'CIDCO/AQI/API/',
  MANUAL: 'CIDCO/AQI/',
};

/** What every channel gives back when a reading is stored. */
export type StoredReading = {
  id: string;
  referenceNo: string;
  userId: string;
  source: ReportSource;
  status: ReportStatus;
  siteName: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  measuredAt: Date;
  aqiValue: number;
  pm25: number | null;
  pm10: number | null;
  so2: number | null;
  no2: number | null;
  co: number | null;
  ozone: number | null;
  remarks: string | null;
  projectSiteId: string | null;
  monitoringStationId: string | null;
  oem: string | null;
  deviceModel: string | null;
  temperature: number | null;
  humidity: number | null;
  integrationMethod: string | null;
  otherParams: unknown;
  receivedAt: Date;
  createdAt: Date;
  attachments: Array<{
    id: string;
    kind: AttachmentKind;
    fileName: string;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  project: { id: string; name: string; code: string } | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Delegate = {
  count(args?: any): Promise<number>;
  findMany(args?: any): Promise<any[]>;
  findFirst(args?: any): Promise<any | null>;
  findUnique(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
  aggregate(args: any): Promise<any>;
  groupBy(args: any): Promise<any[]>;
};

export function readingDelegate(channel: ReadingChannel): Delegate {
  if (channel === 'SFTP') return prisma.sftpReading as unknown as Delegate;
  if (channel === 'API') return prisma.apiReading as unknown as Delegate;
  return prisma.report as unknown as Delegate;
}

/**
 * Which tables a request has to touch. A `source` filter narrows it to one;
 * without one, every channel is in scope.
 */
export function channelsFor(source?: string | null): ReadingChannel[] {
  if (!source) return READING_CHANNELS;
  const channel = CHANNEL_OF_SOURCE[source as ReportSource];
  return channel ? [channel] : [];
}

type ReadingWhere = Record<string, unknown>;
type OrderBy = Record<string, 'asc' | 'desc'>;

export async function countReadings(where: ReadingWhere = {}, channels = READING_CHANNELS) {
  const counts = await Promise.all(
    channels.map((c) => readingDelegate(c).count({ where })),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Page across the channel tables as if they were one.
 *
 * Each table is asked for the first `skip + take` rows in the requested order;
 * merging those and slicing gives exactly the page a single table would have
 * returned, without needing a cross-table cursor.
 */
export async function findReadings(
  args: {
    where?: ReadingWhere;
    orderBy?: OrderBy;
    skip?: number;
    take?: number;
    select?: Record<string, unknown>;
    include?: Record<string, unknown>;
  },
  channels = READING_CHANNELS,
) {
  const { where = {}, orderBy = { receivedAt: 'desc' }, skip = 0, take = 25, select, include } = args;
  const perTable = skip + take;

  const pages = await Promise.all(
    channels.map((c) =>
      readingDelegate(c).findMany({
        where,
        orderBy,
        take: perTable,
        ...(select ? { select } : {}),
        ...(include ? { include } : {}),
      }),
    ),
  );

  return sortRows(pages.flat(), orderBy).slice(skip, skip + take);
}

/** Find one reading by id without knowing which channel carried it. */
export async function findReadingAnywhere(
  id: string,
  args: { select?: Record<string, unknown>; include?: Record<string, unknown> } = {},
) {
  for (const channel of READING_CHANNELS) {
    const row = await readingDelegate(channel).findUnique({ where: { id }, ...args });
    if (row) return { channel, row };
  }
  return null;
}

/** AQI min / max / average over every channel in scope. */
export async function aggregateAqi(where: ReadingWhere = {}, channels = READING_CHANNELS) {
  const parts = await Promise.all(
    channels.map((c) =>
      readingDelegate(c).aggregate({
        where,
        _count: { _all: true },
        _sum: { aqiValue: true },
        _max: { aqiValue: true },
        _min: { aqiValue: true },
      }),
    ),
  );

  let count = 0;
  let sum = 0;
  let max: number | null = null;
  let min: number | null = null;
  for (const p of parts) {
    count += p._count._all ?? 0;
    sum += p._sum.aqiValue ?? 0;
    if (p._max.aqiValue != null) max = max == null ? p._max.aqiValue : Math.max(max, p._max.aqiValue);
    if (p._min.aqiValue != null) min = min == null ? p._min.aqiValue : Math.min(min, p._min.aqiValue);
  }

  return { count, average: count ? Math.round(sum / count) : null, max, min };
}

/** Row counts by one column (e.g. status, source) across every channel. */
export async function countReadingsBy(
  field: 'status' | 'source',
  where: ReadingWhere = {},
  channels = READING_CHANNELS,
) {
  const parts = await Promise.all(
    channels.map((c) =>
      readingDelegate(c).groupBy({ by: [field], where, _count: { _all: true } }),
    ),
  );

  const totals: Record<string, number> = {};
  for (const group of parts.flat()) {
    const key = String(group[field]);
    totals[key] = (totals[key] ?? 0) + (group._count?._all ?? 0);
  }
  return totals;
}

function sortRows(rows: any[], orderBy: OrderBy) {
  const [field, direction] = Object.entries(orderBy)[0] ?? ['receivedAt', 'desc'];
  const sign = direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const left = a?.[field];
    const right = b?.[field];
    if (left === right) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return left < right ? -sign : sign;
  });
}
