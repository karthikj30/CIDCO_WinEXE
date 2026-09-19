'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson } from '@/lib/fetchJson';

type Row = {
  id: string;
  referenceNo: string;
  projectSiteId: string | null;
  monitoringStationId: string | null;
  oem: string | null;
  deviceModel: string | null;
  siteName: string;
  location: string;
  measuredAt: string;
  aqiValue: number;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  ozone: number | null;
  temperature: number | null;
  humidity: number | null;
  otherParams: Record<string, unknown> | null;
  source: string;
  integrationMethod: string | null;
  status: string;
  receivedAt: string;
  user: { name: string; email: string } | null;
};

const num = (v: number | null) => (v === null || v === undefined ? '—' : v);
const txt = (v: string | null) => (v ? v : '—');
const dt = (v: string) =>
  new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const AQI_COLOR = (a: number) =>
  a <= 50 ? 'bg-emerald-100 text-emerald-800'
    : a <= 100 ? 'bg-lime-100 text-lime-800'
    : a <= 200 ? 'bg-amber-100 text-amber-800'
    : a <= 300 ? 'bg-orange-100 text-orange-800'
    : a <= 400 ? 'bg-red-100 text-red-800'
    : 'bg-rose-200 text-rose-900';

export default function DataTablePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (q) params.set('q', q);
      if (source) params.set('source', source);
      const res = await fetch(`/api/admin/reports?${params.toString()}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.rows);
      setTotal(json.data.total);
      setTotalPages(json.data.totalPages);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, source]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Live auto-refresh.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live) timer.current = setInterval(() => void load(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, load]);

  const COLS = [
    'Reference', 'Received', 'Measured', 'Project/Site', 'Station', 'OEM / Model',
    'AQI', 'PM2.5', 'PM10', 'NO₂', 'SO₂', 'CO', 'O₃', 'Temp °C', 'Humidity %',
    'Source', 'Integration', 'Status',
  ];

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">AQI Data (PostgreSQL)</h2>
          <p className="mt-1 text-sm text-slate-500">
            Live view of the <code className="rounded bg-slate-100 px-1 text-xs">reports</code> table — every reading fed in by architects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="rounded border-slate-300" />
            Live
          </label>
          <button onClick={() => load()} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Refresh
          </button>
        </div>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => { setPage(1); setQ(e.target.value); }}
          placeholder="Search reference, site, station…"
          className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
        />
        <select value={source} onChange={(e) => { setPage(1); setSource(e.target.value); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All sources</option>
          <option value="API">API</option>
          <option value="CSV">CSV</option>
          <option value="WEB">WEB</option>
        </select>
        <select value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <span className="text-xs text-slate-400">
          {total} row{total === 1 ? '' : 's'}
          {updatedAt && ` · updated ${updatedAt.toLocaleTimeString('en-IN')}`}
          {live && ' · live'}
        </span>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
              <tr>
                {COLS.map((c) => <th key={c} className="px-3 py-2.5 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={COLS.length} className="px-3 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLS.length} className="px-3 py-8 text-center text-slate-500">No readings yet.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-cidco-700">{r.referenceNo}</td>
                    <td className="px-3 py-2 text-slate-500">{dt(r.receivedAt)}</td>
                    <td className="px-3 py-2 text-slate-500">{dt(r.measuredAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{txt(r.projectSiteId) === '—' ? r.siteName : r.projectSiteId}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{txt(r.monitoringStationId)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.oem || r.deviceModel ? `${txt(r.oem)} / ${txt(r.deviceModel)}` : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded px-1.5 py-0.5 font-semibold ${AQI_COLOR(r.aqiValue)}`}>{r.aqiValue}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{num(r.pm25)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.pm10)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.no2)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.so2)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.co)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.ozone)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.temperature)}</td>
                    <td className="px-3 py-2 text-slate-600">{num(r.humidity)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.source}</td>
                    <td className="px-3 py-2 text-slate-500">{txt(r.integrationMethod)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{r.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
