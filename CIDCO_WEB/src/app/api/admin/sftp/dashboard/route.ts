import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import {
  AQI_BANDS, DEFAULT_RADIUS_METRES, POLLUTANTS,
  bandOf, checkLocation, reportingStatus,
  type AqiBandKey,
} from '@/lib/aqi';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/dashboard
 *
 * Everything the monitoring dashboard draws, from one filtered set of
 * readings — so the map, the tiles and the five charts can never disagree
 * about which readings they are describing.
 *
 * It reads the `reports` table rather than the JSON on each filed CSV: these
 * are the readings CIDCO actually stored, which is what an authority acts on.
 * Rows that were rejected never became readings and are counted separately,
 * on the delivery side, where the ingestion status explains why.
 *
 * Filters (all optional, all applied together):
 *   node, department  — the CIDCO node and department the site belongs to
 *   site              — one site name
 *   contractor        — the architect responsible
 *   station           — one monitoring station id
 *   band              — only readings in this AQI band
 *   status            — only sites with this reporting status
 *   hours             — how far back to look (default 24)
 */
type Bucket = { at: string; sum: number; n: number };

const HOUR = 3_600_000;

export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const q = new URL(req.url).searchParams;
    const hours = Math.min(Math.max(Number(q.get('hours') ?? 24) || 24, 1), 24 * 365);
    const since = new Date(Date.now() - hours * HOUR);
    const now = new Date();

    const pick = (k: string) => {
      const v = q.get(k);
      return v && v.trim() ? v.trim() : null;
    };
    const node = pick('node');
    const department = pick('department');
    const site = pick('site');
    const contractor = pick('contractor');
    const station = pick('station');
    const band = pick('band') as AqiBandKey | null;
    const status = pick('status');

    // --- which sites are in scope -----------------------------------------
    const companyWhere: Prisma.CompanyWhereInput = {
      ...(node ? { nodeId: node } : {}),
      ...(department ? { departmentId: department } : {}),
      ...(site ? { siteName: site } : {}),
      ...(contractor ? { architectName: contractor } : {}),
    };

    const [companies, nodes, departments] = await Promise.all([
      prisma.company.findMany({
        where: companyWhere,
        include: { department: true, node: true },
        orderBy: { siteName: 'asc' },
      }),
      prisma.node.findMany({ orderBy: { name: 'asc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
    ]);

    const byId = new Map(companies.map((c) => [c.id, c]));
    const ids = companies.map((c) => c.id);

    // Nothing in scope: answer with the shape the page expects rather than
    // making every panel handle a missing field.
    if (ids.length === 0) {
      return ok(empty({ nodes, departments, contractors: [], stations: [], hours }));
    }

    // --- the readings, and the deliveries that carried them ---------------
    const [readings, files] = await Promise.all([
      prisma.report.findMany({
        where: {
          companyRecordId: { in: ids },
          measuredAt: { gte: since },
          ...(station ? { monitoringStationId: station } : {}),
        },
        orderBy: { measuredAt: 'asc' },
        select: {
          companyRecordId: true, measuredAt: true, aqiValue: true,
          pm25: true, pm10: true, no2: true, so2: true, co: true, ozone: true,
          latitude: true, longitude: true, monitoringStationId: true, projectSiteId: true,
        },
      }),
      prisma.dataFile.findMany({
        where: { companyRecordId: { in: ids } },
        orderBy: { receivedAt: 'desc' },
        select: {
          companyRecordId: true, receivedAt: true, latitude: true, longitude: true,
          pollStatus: true, rowCount: true, importedCount: true, deliveredName: true,
        },
      }),
    ]);

    const inBand = band ? readings.filter((r) => bandOf(r.aqiValue) === band) : readings;

    // The newest delivery per site tells the map where data is coming from
    // and whether the site is still reporting at all.
    const latestFile = new Map<string, (typeof files)[number]>();
    for (const f of files) {
      if (f.companyRecordId && !latestFile.has(f.companyRecordId)) latestFile.set(f.companyRecordId, f);
    }

    // --- 3. Current AQI by site, and the map ------------------------------
    const latestReading = new Map<string, (typeof readings)[number]>();
    for (const r of inBand) {
      if (!r.companyRecordId) continue;
      const held = latestReading.get(r.companyRecordId);
      if (!held || r.measuredAt > held.measuredAt) latestReading.set(r.companyRecordId, r);
    }

    let sites = companies.map((c) => {
      const last = latestReading.get(c.id) ?? null;
      const file = latestFile.get(c.id) ?? null;
      const reporting = reportingStatus(file?.receivedAt ?? null, now);
      const location = checkLocation(
        {
          latitude: c.registeredLatitude,
          longitude: c.registeredLongitude,
          radiusMetres: c.permittedRadiusMetres || DEFAULT_RADIUS_METRES,
        },
        { latitude: file?.latitude ?? null, longitude: file?.longitude ?? null },
      );

      return {
        id: c.id,
        siteName: c.siteName,
        node: c.node?.name ?? null,
        department: c.department?.name ?? null,
        contractor: c.architectName ?? null,
        address: c.address ?? null,
        stationId: last?.monitoringStationId ?? null,
        projectSiteId: last?.projectSiteId ?? null,
        aqi: last?.aqiValue ?? null,
        band: bandOf(last?.aqiValue),
        measuredAt: last?.measuredAt ?? null,
        pollutants: Object.fromEntries(
          POLLUTANTS.map((p) => [p.key, (last?.[p.key] as number | null) ?? null]),
        ) as Record<string, number | null>,
        registered: { latitude: c.registeredLatitude, longitude: c.registeredLongitude },
        reported: { latitude: file?.latitude ?? null, longitude: file?.longitude ?? null },
        permittedRadiusMetres: c.permittedRadiusMetres || DEFAULT_RADIUS_METRES,
        location,
        reporting,
        lastDeliveryAt: file?.receivedAt ?? null,
        lastDeliveredName: file?.deliveredName ?? null,
        readingCount: inBand.filter((r) => r.companyRecordId === c.id).length,
      };
    });

    if (status) sites = sites.filter((s) => s.reporting === status);
    const shownIds = new Set(sites.map((s) => s.id));
    const scoped = inBand.filter((r) => r.companyRecordId && shownIds.has(r.companyRecordId));

    // --- 1 & 2. Trends ----------------------------------------------------
    // Bucketed so a month of readings is still a chart and not a smear: an
    // hour each for a day, a day each beyond that.
    const byHour = hours <= 48;
    const stamp = (d: Date) => {
      const t = new Date(d);
      t.setMinutes(0, 0, 0);
      if (!byHour) t.setHours(0, 0, 0, 0);
      return t.toISOString();
    };

    const aqiBuckets = new Map<string, Bucket>();
    const pollutantBuckets = new Map<string, Map<string, Bucket>>();
    for (const p of POLLUTANTS) pollutantBuckets.set(p.key, new Map());

    for (const r of scoped) {
      const key = stamp(r.measuredAt);
      const a = aqiBuckets.get(key) ?? { at: key, sum: 0, n: 0 };
      a.sum += r.aqiValue;
      a.n += 1;
      aqiBuckets.set(key, a);

      for (const p of POLLUTANTS) {
        const value = r[p.key] as number | null;
        if (value === null || value === undefined) continue;
        const map = pollutantBuckets.get(p.key)!;
        const b = map.get(key) ?? { at: key, sum: 0, n: 0 };
        b.sum += value;
        b.n += 1;
        map.set(key, b);
      }
    }

    const mean = (b: Bucket) => Math.round((b.sum / b.n) * 10) / 10;
    const ordered = (m: Map<string, Bucket>) =>
      [...m.values()].sort((x, y) => x.at.localeCompare(y.at)).map((b) => ({ at: b.at, value: mean(b) }));

    const aqiTrend = ordered(aqiBuckets);
    const pollutantTrend = POLLUTANTS.map((p) => ({
      key: p.key,
      label: p.label,
      color: p.color,
      points: ordered(pollutantBuckets.get(p.key)!),
    })).filter((s) => s.points.length > 0);

    // --- 4. Category distribution per site --------------------------------
    const distribution = sites.map((s) => {
      const counts = Object.fromEntries(AQI_BANDS.map((b) => [b.key, 0])) as Record<AqiBandKey, number>;
      for (const r of scoped) {
        if (r.companyRecordId !== s.id) continue;
        const key = bandOf(r.aqiValue);
        if (key) counts[key] += 1;
      }
      const total = Object.values(counts).reduce((n, v) => n + v, 0);
      return { siteName: s.siteName, counts, total };
    }).filter((d) => d.total > 0);

    // --- 5. Dominant pollutant --------------------------------------------
    // The mean of each pollutant over the window, per site. "Dominant" is the
    // largest sub-index, which is how CPCB decides it too.
    const contribution = sites.map((s) => {
      const totals = new Map<string, { sum: number; n: number }>();
      for (const r of scoped) {
        if (r.companyRecordId !== s.id) continue;
        for (const p of POLLUTANTS) {
          const value = r[p.key] as number | null;
          if (value === null || value === undefined) continue;
          const held = totals.get(p.key) ?? { sum: 0, n: 0 };
          held.sum += value;
          held.n += 1;
          totals.set(p.key, held);
        }
      }
      const values = POLLUTANTS.map((p) => {
        const held = totals.get(p.key);
        return {
          key: p.key,
          label: p.label,
          color: p.color,
          value: held ? Math.round((held.sum / held.n) * 10) / 10 : null,
        };
      });
      const ranked = values.filter((v) => v.value !== null).sort((a, b) => b.value! - a.value!);
      return {
        siteName: s.siteName,
        values,
        dominant: ranked[0] ?? null,
        topThree: ranked.slice(0, 3),
      };
    }).filter((c) => c.dominant !== null);

    // --- the headline tiles ------------------------------------------------
    const aqiValues = sites.map((s) => s.aqi).filter((v): v is number => v !== null);
    const totals = {
      sites: sites.length,
      reporting: sites.filter((s) => s.reporting === 'NORMAL').length,
      delayed: sites.filter((s) => s.reporting === 'DELAYED').length,
      silent: sites.filter((s) => s.reporting === 'SILENT' || s.reporting === 'NEVER').length,
      // Poor and worse — the band where CPCB expects an authority to act.
      highAqi: sites.filter((s) => s.aqi !== null && s.aqi > 200).length,
      locationMismatch: sites.filter((s) => s.location.status === 'MISMATCH').length,
      readings: scoped.length,
      averageAqi: aqiValues.length
        ? Math.round(aqiValues.reduce((n, v) => n + v, 0) / aqiValues.length)
        : null,
      peakAqi: aqiValues.length ? Math.max(...aqiValues) : null,
    };

    return ok({
      hours,
      bucket: byHour ? 'hour' : 'day',
      generatedAt: now.toISOString(),
      totals,
      sites,
      aqiTrend,
      pollutantTrend,
      distribution,
      contribution,
      filters: {
        nodes: nodes.map((n) => ({ id: n.id, name: n.name })),
        departments: departments.map((d) => ({ id: d.id, name: d.name })),
        contractors: [...new Set(companies.map((c) => c.architectName).filter(Boolean))].sort() as string[],
        stations: [...new Set(readings.map((r) => r.monitoringStationId).filter(Boolean))].sort() as string[],
        sites: companies.map((c) => c.siteName),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** The same shape, with nothing in it, so no panel has to special-case empty. */
function empty(base: {
  nodes: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  contractors: string[];
  stations: string[];
  hours: number;
}) {
  return {
    hours: base.hours,
    bucket: 'hour' as const,
    generatedAt: new Date().toISOString(),
    totals: {
      sites: 0, reporting: 0, delayed: 0, silent: 0, highAqi: 0,
      locationMismatch: 0, readings: 0, averageAqi: null, peakAqi: null,
    },
    sites: [],
    aqiTrend: [],
    pollutantTrend: [],
    distribution: [],
    contribution: [],
    filters: {
      nodes: base.nodes.map((n) => ({ id: n.id, name: n.name })),
      departments: base.departments.map((d) => ({ id: d.id, name: d.name })),
      contractors: base.contractors,
      stations: base.stations,
      sites: [],
    },
  };
}
