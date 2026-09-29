import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import {
  AQI_BANDS, DEFAULT_RADIUS_METRES, MAX_COMPARED_SITES, POLLUTANTS, SITE_COLORS,
  bandOf, checkLocation, reportingStatus,
  type AqiBandKey, type PollutantKey,
} from '@/lib/aqi';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/dashboard
 *
 * Everything the monitoring dashboard draws, from one filtered set of
 * readings — so the map, the tiles and the charts can never disagree about
 * which readings they are describing.
 *
 * It reads both channels: `sftp_readings` (what the Windows agent delivered)
 * and `api_readings` (what stations posted to the REST API). A reading belongs
 * to a registered site through `companyRecordId` — the SFTP account's site, or
 * the site the API handshake is linked to. API readings from a handshake that
 * is not linked to a site yet still count: they appear as their own entry,
 * "API · <architect>", so nothing that reached CIDCO is left off the charts.
 * Those entries have no node, department or registered position, so the
 * filters on those fields leave them out.
 *
 * Filters (all optional, all applied together):
 *   channel           — SFTP or API; both when absent
 *   node, department  — the CIDCO node and department the site belongs to
 *   site              — one site name
 *   contractor        — the architect responsible
 *   station           — one monitoring station id
 *   band              — only readings in this AQI band
 *   status            — only sites with this reporting status
 *   hours             — how far back to look (default 24)
 */
type Bucket = { at: string; sum: number; n: number };
type Channel = 'SFTP' | 'API';

/** One reading, whichever table it came from. */
type Reading = {
  siteKey: string;
  channel: Channel;
  measuredAt: Date;
  aqiValue: number;
  monitoringStationId: string | null;
  projectSiteId: string | null;
} & Record<PollutantKey, number | null>;

/** The latest thing a site sent, whichever channel carried it. */
type Delivery = {
  at: Date;
  latitude: number | null;
  longitude: number | null;
  name: string | null;
  channel: Channel;
};

const HOUR = 3_600_000;
const UNLINKED = 'api:';

const READING_SELECT = {
  companyRecordId: true, measuredAt: true, aqiValue: true,
  pm25: true, pm10: true, no2: true, so2: true, co: true, ozone: true,
  monitoringStationId: true, projectSiteId: true,
} as const;

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
    const channelParam = pick('channel');
    const channel: Channel | null = channelParam === 'SFTP' || channelParam === 'API' ? channelParam : null;
    const node = pick('node');
    const department = pick('department');
    const site = pick('site');
    const contractor = pick('contractor');
    const station = pick('station');
    const band = pick('band') as AqiBandKey | null;
    const status = pick('status');

    const wantSftp = channel !== 'API';
    const wantApi = channel !== 'SFTP';
    // Readings with no site have no node, department or contractor either, so
    // any of those filters rules them out.
    const allowUnlinked = wantApi && !node && !department && !contractor;

    // --- which registered sites are in scope ------------------------------
    const companyWhere: Prisma.CompanyWhereInput = {
      ...(node ? { nodeId: node } : {}),
      ...(department ? { departmentId: department } : {}),
      ...(contractor ? { architectName: contractor } : {}),
    };

    const [allCompanies, nodes, departments] = await Promise.all([
      prisma.company.findMany({
        where: companyWhere,
        include: { department: true, node: true },
        orderBy: { siteName: 'asc' },
      }),
      prisma.node.findMany({ orderBy: { name: 'asc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
    ]);

    // --- API integrations not linked to a site ----------------------------
    const unlinkedHandshakes = allowUnlinked
      ? await prisma.architectHandshake.findMany({
          where: { channel: 'API', apiReadings: { some: { companyRecordId: null } } },
          include: { architect: { select: { name: true, firmName: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const unlinkedName = (h: (typeof unlinkedHandshakes)[number]) =>
      `API · ${h.architect.firmName || h.architect.name} (${h.clientId})`;

    const companies = site ? allCompanies.filter((c) => c.siteName === site) : allCompanies;
    const pseudo = (site ? unlinkedHandshakes.filter((h) => unlinkedName(h) === site) : unlinkedHandshakes);

    const ids = companies.map((c) => c.id);
    const pseudoIds = pseudo.map((h) => h.id);

    const siteNames = [
      ...allCompanies.map((c) => c.siteName),
      ...unlinkedHandshakes.map(unlinkedName),
    ];

    if (ids.length === 0 && pseudoIds.length === 0) {
      return ok(empty({ nodes, departments, hours, sites: siteNames }));
    }

    const stationWhere = station ? { monitoringStationId: station } : {};
    const window = { measuredAt: { gte: since } };

    // --- the readings, both channels --------------------------------------
    const [sftpRows, apiLinked, apiUnlinked] = await Promise.all([
      wantSftp && ids.length
        ? prisma.sftpReading.findMany({
            where: { companyRecordId: { in: ids }, ...window, ...stationWhere },
            select: READING_SELECT,
          })
        : [],
      wantApi && ids.length
        ? prisma.apiReading.findMany({
            where: { companyRecordId: { in: ids }, ...window, ...stationWhere },
            select: READING_SELECT,
          })
        : [],
      pseudoIds.length
        ? prisma.apiReading.findMany({
            where: { companyRecordId: null, handshakeId: { in: pseudoIds }, ...window, ...stationWhere },
            select: { ...READING_SELECT, handshakeId: true },
          })
        : [],
    ]);

    const readings: Reading[] = [
      ...sftpRows.map((r) => ({ ...r, siteKey: r.companyRecordId!, channel: 'SFTP' as const })),
      ...apiLinked.map((r) => ({ ...r, siteKey: r.companyRecordId!, channel: 'API' as const })),
      ...apiUnlinked.map((r) => ({ ...r, siteKey: UNLINKED + r.handshakeId, channel: 'API' as const })),
    ].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());

    // --- the latest delivery per site, from either channel ----------------
    // Reporting status and the position on the map come from whatever the site
    // sent last, not from the reading window: a site that went quiet two days
    // ago is "not reporting" even when the window is 24 hours.
    const latest = new Map<string, Delivery>();
    const offer = (key: string, d: Delivery) => {
      const held = latest.get(key);
      if (!held || d.at > held.at) latest.set(key, d);
    };

    const [files, apiLatestLinked, apiLatestUnlinked] = await Promise.all([
      wantSftp && ids.length
        ? prisma.dataFile.findMany({
            where: { companyRecordId: { in: ids } },
            orderBy: { receivedAt: 'desc' },
            distinct: ['companyRecordId'],
            select: { companyRecordId: true, receivedAt: true, latitude: true, longitude: true, deliveredName: true },
          })
        : [],
      wantApi && ids.length
        ? prisma.apiReading.findMany({
            where: { companyRecordId: { in: ids } },
            orderBy: { receivedAt: 'desc' },
            distinct: ['companyRecordId'],
            select: { companyRecordId: true, receivedAt: true, latitude: true, longitude: true, referenceNo: true },
          })
        : [],
      pseudoIds.length
        ? prisma.apiReading.findMany({
            where: { companyRecordId: null, handshakeId: { in: pseudoIds } },
            orderBy: { receivedAt: 'desc' },
            distinct: ['handshakeId'],
            select: { handshakeId: true, receivedAt: true, latitude: true, longitude: true, referenceNo: true },
          })
        : [],
    ]);

    for (const f of files) {
      offer(f.companyRecordId, {
        at: f.receivedAt, latitude: f.latitude, longitude: f.longitude, name: f.deliveredName, channel: 'SFTP',
      });
    }
    for (const r of apiLatestLinked) {
      offer(r.companyRecordId!, {
        at: r.receivedAt, latitude: r.latitude, longitude: r.longitude, name: r.referenceNo, channel: 'API',
      });
    }
    for (const r of apiLatestUnlinked) {
      offer(UNLINKED + r.handshakeId, {
        at: r.receivedAt, latitude: r.latitude, longitude: r.longitude, name: r.referenceNo, channel: 'API',
      });
    }

    const inBand = band ? readings.filter((r) => bandOf(r.aqiValue) === band) : readings;

    const latestReading = new Map<string, Reading>();
    const channelsOf = new Map<string, Set<Channel>>();
    const countOf = new Map<string, number>();
    for (const r of inBand) {
      const held = latestReading.get(r.siteKey);
      if (!held || r.measuredAt > held.measuredAt) latestReading.set(r.siteKey, r);
      const set = channelsOf.get(r.siteKey) ?? new Set<Channel>();
      set.add(r.channel);
      channelsOf.set(r.siteKey, set);
      countOf.set(r.siteKey, (countOf.get(r.siteKey) ?? 0) + 1);
    }

    // --- 3. Current AQI by site, and the map ------------------------------
    const describe = (
      key: string,
      base: {
        siteName: string; node: string | null; department: string | null; contractor: string | null;
        address: string | null; registered: { latitude: number | null; longitude: number | null };
        radius: number; linked: boolean;
      },
    ) => {
      const last = latestReading.get(key) ?? null;
      const delivery = latest.get(key) ?? null;
      const reported = { latitude: delivery?.latitude ?? null, longitude: delivery?.longitude ?? null };
      return {
        id: key,
        siteName: base.siteName,
        node: base.node,
        department: base.department,
        contractor: base.contractor,
        address: base.address,
        linked: base.linked,
        channels: [...(channelsOf.get(key) ?? [])].sort() as Channel[],
        stationId: last?.monitoringStationId ?? null,
        projectSiteId: last?.projectSiteId ?? null,
        aqi: last?.aqiValue ?? null,
        band: bandOf(last?.aqiValue),
        measuredAt: last?.measuredAt ?? null,
        pollutants: Object.fromEntries(POLLUTANTS.map((p) => [p.key, last?.[p.key] ?? null])) as Record<string, number | null>,
        registered: base.registered,
        reported,
        permittedRadiusMetres: base.radius,
        location: checkLocation({ ...base.registered, radiusMetres: base.radius }, reported),
        reporting: reportingStatus(delivery?.at ?? null, now),
        lastDeliveryAt: delivery?.at ?? null,
        lastDeliveredName: delivery?.name ?? null,
        lastDeliveryChannel: delivery?.channel ?? null,
        readingCount: countOf.get(key) ?? 0,
      };
    };

    let sites = [
      ...companies.map((c) =>
        describe(c.id, {
          siteName: c.siteName,
          node: c.node?.name ?? null,
          department: c.department?.name ?? null,
          contractor: c.architectName ?? null,
          address: c.address ?? null,
          registered: { latitude: c.registeredLatitude, longitude: c.registeredLongitude },
          radius: c.permittedRadiusMetres || DEFAULT_RADIUS_METRES,
          linked: true,
        }),
      ),
      ...pseudo.map((h) =>
        describe(UNLINKED + h.id, {
          siteName: unlinkedName(h),
          node: null,
          department: null,
          contractor: h.architect.name,
          address: null,
          registered: { latitude: null, longitude: null },
          radius: DEFAULT_RADIUS_METRES,
          linked: false,
        }),
      ),
    ];

    // An unlinked integration is only on the dashboard because of its readings,
    // so one with none in this window has nothing to show and is left off —
    // a registered site stays listed either way, since its silence is news.
    sites = sites.filter((s) => s.linked || s.readingCount > 0);

    if (status) sites = sites.filter((s) => s.reporting === status);

    // A filter on the readings has to narrow the sites too. Picking one
    // channel, one band or one station and still being told "8 sites" counts
    // sites that have nothing to do with the answer.
    if (band || station || channel) sites = sites.filter((s) => s.readingCount > 0);
    const shownIds = new Set(sites.map((s) => s.id));
    const scoped = inBand.filter((r) => shownIds.has(r.siteKey));

    // --- 1 & 2. Trends ----------------------------------------------------
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
        const value = r[p.key];
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

    // --- AQI per site over time, for comparing sites against each other ---
    const perSite = new Map<string, Map<string, Bucket>>();
    for (const r of scoped) {
      const key = stamp(r.measuredAt);
      const map = perSite.get(r.siteKey) ?? new Map<string, Bucket>();
      const b = map.get(key) ?? { at: key, sum: 0, n: 0 };
      b.sum += r.aqiValue;
      b.n += 1;
      map.set(key, b);
      perSite.set(r.siteKey, map);
    }

    const comparison = sites
      .filter((s) => perSite.has(s.id))
      .sort((a, b) => b.readingCount - a.readingCount)
      .slice(0, MAX_COMPARED_SITES)
      .map((s, i) => ({
        key: s.id,
        label: s.siteName,
        color: SITE_COLORS[i % SITE_COLORS.length],
        points: ordered(perSite.get(s.id)!),
      }));

    // --- 4. Category distribution per site --------------------------------
    const distribution = sites.map((s) => {
      const counts = Object.fromEntries(AQI_BANDS.map((b) => [b.key, 0])) as Record<AqiBandKey, number>;
      for (const r of scoped) {
        if (r.siteKey !== s.id) continue;
        const key = bandOf(r.aqiValue);
        if (key) counts[key] += 1;
      }
      const total = Object.values(counts).reduce((n, v) => n + v, 0);
      return { siteName: s.siteName, counts, total };
    }).filter((d) => d.total > 0);

    // --- 5. Dominant pollutant --------------------------------------------
    const contribution = sites.map((s) => {
      const totals = new Map<string, { sum: number; n: number }>();
      for (const r of scoped) {
        if (r.siteKey !== s.id) continue;
        for (const p of POLLUTANTS) {
          const value = r[p.key];
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
      return { siteName: s.siteName, values, dominant: ranked[0] ?? null, topThree: ranked.slice(0, 3) };
    }).filter((c) => c.dominant !== null);

    // --- the headline tiles ------------------------------------------------
    const aqiValues = sites.map((s) => s.aqi).filter((v): v is number => v !== null);
    const totals = {
      sites: sites.length,
      reporting: sites.filter((s) => s.reporting === 'NORMAL').length,
      delayed: sites.filter((s) => s.reporting === 'DELAYED').length,
      silent: sites.filter((s) => s.reporting === 'SILENT' || s.reporting === 'NEVER').length,
      highAqi: sites.filter((s) => s.aqi !== null && s.aqi > 200).length,
      locationMismatch: sites.filter((s) => s.location.status === 'MISMATCH').length,
      readings: scoped.length,
      sftpReadings: scoped.filter((r) => r.channel === 'SFTP').length,
      apiReadings: scoped.filter((r) => r.channel === 'API').length,
      unlinkedApiSites: sites.filter((s) => !s.linked).length,
      averageAqi: aqiValues.length
        ? Math.round(aqiValues.reduce((n, v) => n + v, 0) / aqiValues.length)
        : null,
      peakAqi: aqiValues.length ? Math.max(...aqiValues) : null,
    };

    return ok({
      hours,
      bucket: byHour ? 'hour' : 'day',
      generatedAt: now.toISOString(),
      channel,
      totals,
      sites,
      aqiTrend,
      pollutantTrend,
      comparison,
      distribution,
      contribution,
      filters: {
        nodes: nodes.map((n) => ({ id: n.id, name: n.name })),
        departments: departments.map((d) => ({ id: d.id, name: d.name })),
        contractors: [...new Set(allCompanies.map((c) => c.architectName).filter(Boolean))].sort() as string[],
        stations: [...new Set(readings.map((r) => r.monitoringStationId).filter(Boolean))].sort() as string[],
        sites: siteNames,
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
  hours: number;
  sites: string[];
}) {
  return {
    hours: base.hours,
    bucket: 'hour' as const,
    generatedAt: new Date().toISOString(),
    channel: null,
    totals: {
      sites: 0, reporting: 0, delayed: 0, silent: 0, highAqi: 0, locationMismatch: 0,
      readings: 0, sftpReadings: 0, apiReadings: 0, unlinkedApiSites: 0,
      averageAqi: null, peakAqi: null,
    },
    sites: [],
    aqiTrend: [],
    pollutantTrend: [],
    comparison: [],
    distribution: [],
    contribution: [],
    filters: {
      nodes: base.nodes.map((n) => ({ id: n.id, name: n.name })),
      departments: base.departments.map((d) => ({ id: d.id, name: d.name })),
      contractors: [],
      stations: [],
      sites: base.sites,
    },
  };
}
