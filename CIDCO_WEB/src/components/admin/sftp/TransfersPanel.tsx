'use client';

import { useCallback, useEffect, useState } from 'react';
import { readJson } from '@/lib/fetchJson';
import SftpUploadsPanel from './SftpUploadsPanel';
import { AqiLineChart, DeliveriesChart, StatTile } from './Charts';

/**
 * Delivered transfers: what one company has sent, as numbers, charts and a log.
 *
 * It reads the data table rather than CIDCO's intake records, because that is
 * where deliveries actually land — an agent uploading to a plain SFTP folder
 * is picked up by the poll worker and never touches the intake at all. The
 * intake's own list is still here, below, for when it is used.
 */

type Company = { siteName: string; fileCount: number };

type LogRow = {
  id: string;
  deliveredName: string | null;
  fileName: string;
  dateFolder: string;
  relativePath: string;
  sizeBytes: number;
  rowCount: number;
  importedCount: number;
  rejectedCount: number;
  pollStatus: string;
  headline: string | null;
  failedStep: string | null;
  receivedAt: string;
};

type Analytics = {
  siteName: string | null;
  totals: {
    files: number;
    archived: number;
    failed: number;
    rows: number;
    stored: number;
    rejected: number;
    readings: number;
    aqiAverage: number | null;
    aqiPeak: number | null;
    lastDeliveryAt: string | null;
  } | null;
  deliveries: Array<{ dateFolder: string; files: number; stored: number; rejected: number }>;
  series: Array<{ at: string; aqi: number; station: string | null }>;
  log: LogRow[];
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

const STATUS: Record<string, string> = {
  ARCHIVED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  INGESTING: 'bg-blue-100 text-blue-800',
  FILED: 'bg-slate-100 text-slate-700',
  INBOX: 'bg-slate-100 text-slate-700',
};

export default function TransfersPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [siteName, setCompanyId] = useState('');
  const [data, setData] = useState<Analytics | null>(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showIntake, setShowIntake] = useState(false);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/data');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load companies');
      const list: Company[] = json.data.tree.map((n: { company: Company; fileCount: number }) => ({
        siteName: n.company.siteName,
        fileCount: n.fileCount,
      }));
      // Companies that have actually delivered first: opening on an empty one
      // looks like the portal is broken.
      list.sort((a, b) => b.fileCount - a.fileCount);
      setCompanies(list);
      setCompanyId((current) => current || list.find((c) => c.fileCount > 0)?.siteName || list[0]?.siteName || '');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadAnalytics = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/admin/sftp/analytics?siteName=${encodeURIComponent(id)}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setData(json.data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    void loadAnalytics(siteName);
  }, [siteName, loadAnalytics]);

  // Live: the poll worker ingests on its own schedule, so a page opened once
  // and left on a wall goes stale within a tick.
  useEffect(() => {
    if (!live || !siteName) return;
    const t = setInterval(() => {
      void loadAnalytics(siteName);
      void loadCompanies();
    }, 10_000);
    return () => clearInterval(t);
  }, [live, siteName, loadAnalytics, loadCompanies]);

  const totals = data?.totals;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Delivered transfers</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every CSV a company has delivered, with the AQI those readings carried.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Live
          </label>
          <button
            onClick={() => {
              void loadAnalytics(siteName);
              void loadCompanies();
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="tx-company" className="font-medium text-slate-600">Company</label>
        <select
          id="tx-company"
          value={siteName}
          onChange={(e) => setCompanyId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
        >
          {companies.length === 0 && <option value="">No companies yet</option>}
          {companies.map((c) => (
            <option key={c.siteName} value={c.siteName}>
              {c.siteName} ({c.siteName}) — {c.fileCount} file{c.fileCount === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        {totals?.lastDeliveryAt && (
          <span className="text-xs text-slate-500">last delivery {fmt(totals.lastDeliveryAt)}</span>
        )}
      </div>

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !totals || totals.files === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Nothing delivered for this company yet.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Files" value={totals.files} hint={`${totals.archived} archived`} />
            <StatTile label="Readings" value={totals.readings} hint={`${totals.rows} rows delivered`} />
            <StatTile label="Rows stored" value={totals.stored} />
            <StatTile
              label="Rows rejected"
              value={totals.rejected}
              tone={totals.rejected > 0 ? 'warn' : 'plain'}
            />
            <StatTile label="Average AQI" value={totals.aqiAverage ?? '—'} />
            <StatTile label="Peak AQI" value={totals.aqiPeak ?? '—'} />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">
              AQI over time — {siteName}
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              Every reading in the delivered files, including rows that were rejected.
            </p>
            <AqiLineChart points={data?.series ?? []} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Rows stored and rejected, per day</h3>
            <p className="mb-2 text-xs text-slate-500">Each column is one day of deliveries.</p>
            <DeliveriesChart days={data?.deliveries ?? []} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h3 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">
              Transfer log
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Received</th>
                    <th className="px-3 py-2 font-semibold">Delivered as</th>
                    <th className="px-3 py-2 font-semibold">Filed at</th>
                    <th className="px-3 py-2 font-semibold">Size</th>
                    <th className="px-3 py-2 font-semibold">Rows</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.log ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmt(r.receivedAt)}</td>
                      <td className="px-3 py-2 font-mono text-slate-800">{r.deliveredName ?? r.fileName}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{r.relativePath}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{kb(r.sizeBytes)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={r.rejectedCount > 0 ? 'font-semibold text-amber-700' : 'text-slate-600'}>
                          {r.importedCount}/{r.rowCount}
                          {r.rejectedCount > 0 ? ` · ${r.rejectedCount} rejected` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            STATUS[r.pollStatus] ?? 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {r.pollStatus}
                        </span>
                        {r.failedStep && (
                          <p className="mt-1 max-w-md text-[11px] text-red-700">{r.failedStep}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          onClick={() => setShowIntake((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          <span className="text-slate-400">{showIntake ? '▾' : '▸'}</span>
          CIDCO&rsquo;s own SFTP intake
          <span className="ml-auto text-xs font-normal text-slate-400">
            only for agents connecting to the intake, not a plain SFTP folder
          </span>
        </button>
        {showIntake && (
          <div className="border-t border-slate-100 p-5">
            <SftpUploadsPanel />
          </div>
        )}
      </section>
    </div>
  );
}
