'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readJson } from '@/lib/fetchJson';
import {
  AQI_BANDS, AQI_COLOR, BAND_STATUS_COLOR, POLLUTANTS, REPORTING,
  bandLabel, type AqiBandKey, type PollutantKey, type ReportingKey,
} from '@/lib/aqi';
import {
  ChartCard, ColumnChart, Empty, StackedBandChart, TrendChart,
  type Column, type Series,
} from './DashboardCharts';
import type { MapSite } from './SiteMap';

// Leaflet only runs in a browser, so the map is never part of the server render.
const SiteMap = dynamic(() => import('./SiteMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-400">
      Loading map…
    </div>
  ),
});

type Dashboard = {
  hours: number;
  bucket: 'hour' | 'day';
  generatedAt: string;
  totals: {
    sites: number; reporting: number; delayed: number; silent: number;
    highAqi: number; locationMismatch: number; readings: number;
    averageAqi: number | null; peakAqi: number | null;
  };
  sites: MapSite[];
  aqiTrend: Array<{ at: string; value: number }>;
  pollutantTrend: Array<{ key: string; label: string; color: string; points: Array<{ at: string; value: number }> }>;
  distribution: Array<{ siteName: string; counts: Record<AqiBandKey, number>; total: number }>;
  contribution: Array<{
    siteName: string;
    values: Array<{ key: string; label: string; color: string; value: number | null }>;
    dominant: { key: string; label: string; color: string; value: number | null } | null;
    topThree: Array<{ key: string; label: string; color: string; value: number | null }>;
  }>;
  filters: {
    nodes: Array<{ id: string; name: string }>;
    departments: Array<{ id: string; name: string }>;
    contractors: string[];
    stations: string[];
    sites: string[];
  };
};

const RANGES = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
  { label: '90 days', hours: 24 * 90 },
] as const;

const SORTS = [
  { key: 'aqi-desc', label: 'Highest AQI first' },
  { key: 'aqi-asc', label: 'Lowest AQI first' },
  { key: 'name', label: 'Site name' },
] as const;

const SELECT = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm';

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function DashboardPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);

  // --- filters, shared by every panel below ------------------------------
  const [hours, setHours] = useState<number>(24);
  const [node, setNode] = useState('');
  const [department, setDepartment] = useState('');
  const [site, setSite] = useState('');
  const [contractor, setContractor] = useState('');
  const [station, setStation] = useState('');
  const [band, setBand] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('aqi-desc');

  // Which pollutants are drawn. All six at once is unreadable, so the three
  // CIDCO asks about first are on and the rest are a click away.
  const [shown, setShown] = useState<PollutantKey[]>(['pm25', 'pm10', 'no2']);

  // Which site the two trend charts describe. They are about one site over
  // time; "every site at once" would average away the thing being looked for.
  const [trendSite, setTrendSite] = useState('');

  const query = useMemo(() => {
    const p = new URLSearchParams({ hours: String(hours) });
    if (node) p.set('node', node);
    if (department) p.set('department', department);
    if (site) p.set('site', site);
    if (contractor) p.set('contractor', contractor);
    if (station) p.set('station', station);
    if (band) p.set('band', band);
    if (status) p.set('status', status);
    return p.toString();
  }, [hours, node, department, site, contractor, station, band, status]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/sftp/dashboard?${query}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not load the dashboard');
      setData(json.data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [live, load]);

  // The trend charts follow one site; default to the worst one on screen,
  // which is the one an officer opened the dashboard to look at.
  const trendFor = useMemo(() => {
    if (!data) return null;
    if (trendSite) return data.sites.find((s) => s.siteName === trendSite) ?? null;
    return [...data.sites].sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1))[0] ?? null;
  }, [data, trendSite]);

  const [siteTrend, setSiteTrend] = useState<Dashboard | null>(null);
  useEffect(() => {
    if (!trendFor) { setSiteTrend(null); return; }
    let dropped = false;
    (async () => {
      const p = new URLSearchParams({ hours: String(hours), site: trendFor.siteName });
      if (station) p.set('station', station);
      const res = await fetch(`/api/admin/sftp/dashboard?${p}`);
      if (!res.ok || dropped) return;
      const json = await readJson(res);
      setSiteTrend(json.data);
    })();
    return () => { dropped = true; };
  }, [trendFor, hours, station, data?.generatedAt]);

  const sortedSites = useMemo(() => {
    if (!data) return [];
    const rows = [...data.sites];
    if (sort === 'name') return rows.sort((a, b) => a.siteName.localeCompare(b.siteName));
    const dir = sort === 'aqi-asc' ? 1 : -1;
    return rows.sort((a, b) => ((a.aqi ?? -1) - (b.aqi ?? -1)) * dir);
  }, [data, sort]);

  const currentColumns: Column[] = sortedSites
    .filter((s) => s.aqi !== null)
    .slice(0, 12)
    .map((s) => ({
      label: s.siteName,
      value: s.aqi!,
      color: s.band ? BAND_STATUS_COLOR[s.band] : '#898781',
      note: `${bandLabel(s.band)} · ${fmtTime(s.measuredAt)}`,
    }));

  function clear() {
    setNode(''); setDepartment(''); setSite(''); setContractor('');
    setStation(''); setBand(''); setStatus('');
  }

  const filtering = Boolean(node || department || site || contractor || station || band || status);

  if (loading) return <p className="text-sm text-slate-500">Loading the dashboard…</p>;

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">AQI monitoring dashboard</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every reading CIDCO has stored, from the sites that delivered it. Updated as the polls
            store new data.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live
          <button onClick={() => void load()} className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">
            Refresh
          </button>
        </label>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {/* --- filters, one row above everything they affect --- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={SELECT}>
          {RANGES.map((r) => <option key={r.hours} value={r.hours}>{r.label}</option>)}
        </select>
        <select value={node} onChange={(e) => setNode(e.target.value)} className={SELECT}>
          <option value="">All nodes</option>
          {data?.filters.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} className={SELECT}>
          <option value="">All departments</option>
          {data?.filters.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={site} onChange={(e) => setSite(e.target.value)} className={SELECT}>
          <option value="">All sites</option>
          {data?.filters.sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={contractor} onChange={(e) => setContractor(e.target.value)} className={SELECT}>
          <option value="">All contractors</option>
          {data?.filters.contractors.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={station} onChange={(e) => setStation(e.target.value)} className={SELECT}>
          <option value="">All stations</option>
          {data?.filters.stations.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={band} onChange={(e) => setBand(e.target.value)} className={SELECT}>
          <option value="">All AQI bands</option>
          {AQI_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
          <option value="">Any data status</option>
          {(Object.keys(REPORTING) as ReportingKey[]).map((k) => (
            <option key={k} value={k}>{REPORTING[k].label}</option>
          ))}
        </select>
        {filtering && (
          <button onClick={clear} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">as of {fmtTime(data?.generatedAt ?? null)}</span>
      </div>

      {/* --- the headline numbers --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Sites" value={data?.totals.sites ?? 0} hint={`${data?.totals.readings ?? 0} readings`} />
        <Tile label="Reporting" value={data?.totals.reporting ?? 0} hint={`${data?.totals.delayed ?? 0} delayed`} tone="good" />
        <Tile label="Not reporting" value={data?.totals.silent ?? 0} tone={(data?.totals.silent ?? 0) > 0 ? 'bad' : 'plain'} />
        <Tile label="AQI above 200" value={data?.totals.highAqi ?? 0} hint="Poor or worse" tone={(data?.totals.highAqi ?? 0) > 0 ? 'bad' : 'plain'} />
        <Tile label="Location mismatch" value={data?.totals.locationMismatch ?? 0} hint="outside permitted radius" tone={(data?.totals.locationMismatch ?? 0) > 0 ? 'bad' : 'plain'} />
      </div>

      {/* --- the map --- */}
      <SiteMap sites={data?.sites ?? []} />

      {/* --- 3. Current AQI by site --- */}
      <ChartCard
        title="Current AQI by site"
        subtitle="The latest stored reading for each site in scope. Bar colour is the AQI band, named on hover and in the legend."
        right={
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={SELECT}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        }
      >
        <ColumnChart columns={currentColumns} />
        <ul className="mt-3 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-xs text-slate-600">
          {AQI_BANDS.map((b) => (
            <li key={b.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_STATUS_COLOR[b.key] }} />
              {b.label}
            </li>
          ))}
        </ul>
      </ChartCard>

      {/* --- 1 & 2. Trends, for one site --- */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          Trends for
          <select
            value={trendSite || trendFor?.siteName || ''}
            onChange={(e) => setTrendSite(e.target.value)}
            className={SELECT}
          >
            {data?.sites.map((s) => <option key={s.id} value={s.siteName}>{s.siteName}</option>)}
          </select>
          {trendFor && (
            <span className="text-xs text-slate-500">
              last received {fmtTime(trendFor.measuredAt)} · current AQI {trendFor.aqi ?? '—'} ·{' '}
              <strong className="text-slate-800">{bandLabel(trendFor.band)}</strong>
            </span>
          )}
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title={`AQI trend — ${trendFor?.siteName ?? 'no site'}`}
          subtitle={`Mean stored AQI per ${data?.bucket === 'hour' ? 'hour' : 'day'} over the selected range.`}
        >
          {siteTrend && siteTrend.aqiTrend.length > 0 ? (
            <TrendChart
              bucket={siteTrend.bucket}
              series={[{ key: 'aqi', label: 'AQI', color: AQI_COLOR, points: siteTrend.aqiTrend }]}
            />
          ) : (
            <Empty note="No readings for this site in this window." />
          )}
        </ChartCard>

        <ChartCard
          title={`Pollutant trend — ${trendFor?.siteName ?? 'no site'}`}
          subtitle="Pick the pollutants to compare. One shared scale — a second axis would invent crossings that are not there."
          right={
            <div className="flex flex-wrap gap-1">
              {POLLUTANTS.map((p) => {
                const on = shown.includes(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => setShown((list) => on ? list.filter((k) => k !== p.key) : [...list, p.key])}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
                      on ? 'border-slate-400 bg-slate-100 text-slate-900' : 'border-slate-200 text-slate-400'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: on ? p.color : '#cbd5e1' }} />
                    {p.label}
                  </button>
                );
              })}
            </div>
          }
        >
          {siteTrend && siteTrend.pollutantTrend.length > 0 ? (
            <TrendChart
              bucket={siteTrend.bucket}
              series={siteTrend.pollutantTrend.filter((s) => shown.includes(s.key as PollutantKey)) as Series[]}
            />
          ) : (
            <Empty note="No pollutant readings for this site in this window." />
          )}
        </ChartCard>

        {/* --- 4. Category distribution --- */}
        <ChartCard
          title="AQI category distribution"
          subtitle="How many stored readings each site spent in each band — the shape of a site's month, not a single moment."
        >
          <StackedBandChart rows={data?.distribution ?? []} />
        </ChartCard>

        {/* --- 5. Dominant pollutant --- */}
        <DominantCard contribution={data?.contribution ?? []} preferred={trendFor?.siteName ?? null} />
      </div>

      <SiteTable sites={sortedSites} />
    </div>
  );
}

function Tile({
  label, value, hint, tone = 'plain',
}: { label: string; value: number | string; hint?: string; tone?: 'plain' | 'good' | 'bad' }) {
  const colour = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${colour}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Which pollutant is driving the AQI at one site.
 *
 * Shown as the sub-index of every pollutant rather than just the winner's
 * name, because "PM10" alone does not say whether it is a little ahead or
 * three times everything else.
 */
function DominantCard({
  contribution,
  preferred,
}: {
  contribution: Dashboard['contribution'];
  /** The site the rest of the dashboard is looking at, so this opens on it too. */
  preferred: string | null;
}) {
  const [site, setSite] = useState('');
  const chosen =
    contribution.find((c) => c.siteName === site) ??
    contribution.find((c) => c.siteName === preferred) ??
    contribution[0] ??
    null;

  return (
    <ChartCard
      title={`Pollutant contribution — ${chosen?.siteName ?? 'no site'}`}
      subtitle="Mean sub-index per pollutant over the range. The tallest bar is what is driving the AQI."
      right={
        <select value={site || chosen?.siteName || ''} onChange={(e) => setSite(e.target.value)} className={SELECT}>
          {contribution.map((c) => <option key={c.siteName} value={c.siteName}>{c.siteName}</option>)}
        </select>
      }
    >
      {chosen ? (
        <>
          <ColumnChart
            columns={chosen.values
              .filter((v) => v.value !== null)
              .map((v) => ({ label: v.label, value: v.value!, color: v.color }))}
          />
          <p className="mt-2 text-center text-xs text-slate-600">
            Top three:{' '}
            {chosen.topThree.map((t, i) => (
              <span key={t.key}>
                {i > 0 && ', '}
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: t.color }} />
                <strong className="text-slate-900">{t.label}</strong> {t.value}
              </span>
            ))}
          </p>
        </>
      ) : (
        <Empty note="No pollutant readings in this window." />
      )}
    </ChartCard>
  );
}

/** The table view the contrast rule obliges, and the fastest way to scan 100 sites. */
function SiteTable({ sites }: { sites: MapSite[] }) {
  if (sites.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-max min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Site</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Node</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Station</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">AQI</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Category</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Last reading</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Reporting</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Location</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sites.map((s) => (
            <tr key={s.id}>
              <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">{s.siteName}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{s.node ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">{s.stationId ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">{s.aqi ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {s.band ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_STATUS_COLOR[s.band] }} />
                    {bandLabel(s.band)}
                  </span>
                ) : '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtTime(s.measuredAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: REPORTING[s.reporting].color }} />
                  {REPORTING[s.reporting].label}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {s.location.status === 'MATCH' ? <span className="text-emerald-700">✓ within radius</span>
                  : s.location.status === 'MISMATCH' ? <span className="text-red-700">✕ outside radius</span>
                  : <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
