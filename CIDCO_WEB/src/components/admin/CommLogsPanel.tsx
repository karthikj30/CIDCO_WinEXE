'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import HandshakeTimeline from './HandshakeTimeline';
import { readJson } from '@/lib/fetchJson';

type Log = {
  id: string;
  direction: string;
  event: string;
  statusCode: number | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
  handshake: { clientId: string; architect: { name: string; email: string } } | null;
};

type HandshakeOption = { id: string; clientId: string; architect: { email: string } };

const EVENT_STYLE: Record<string, string> = {
  HANDSHAKE_ISSUED: 'bg-slate-100 text-slate-700',
  ARCHITECT_VALIDATED: 'bg-emerald-100 text-emerald-700',
  CHANNEL_ESTABLISHED: 'bg-emerald-100 text-emerald-700',
  VALIDATION_FAILED: 'bg-red-100 text-red-700',
  TOKEN_REQUESTED: 'bg-blue-100 text-blue-700',
  TOKEN_GENERATED: 'bg-cidco-100 text-cidco-700',
  DATA_RECEIVED: 'bg-green-100 text-green-700',
  DATA_REJECTED: 'bg-red-100 text-red-700',
  HANDSHAKE_REVOKED: 'bg-red-100 text-red-700',
};

export default function CommLogsPanel() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [handshakes, setHandshakes] = useState<HandshakeOption[]>([]);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'timeline' | 'table'>('timeline');
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = filter ? `?handshakeId=${filter}&limit=200` : '?limit=200';
      const res = await fetch(`/api/admin/comm-logs${qs}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setLogs(json.data.logs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Load the handshake list once for the filter dropdown.
  useEffect(() => {
    fetch('/api/admin/handshakes')
      .then((r) => (r.ok ? readJson(r) : null))
      .then((j) => j?.success && setHandshakes(j.data.handshakes))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Live auto-refresh.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live) {
      timer.current = setInterval(() => void load(), 4000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, load]);

  const selected = handshakes.find((h) => h.id === filter);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Communication logs</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everything that happened during each handshake — issuance, validation, tokens, data
            transfers and renewals — with timestamps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="rounded border-slate-300" />
            Live
          </label>
          <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="hs-filter" className="sr-only">Filter by handshake</label>
          <select
            id="hs-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
          >
            <option value="">All handshakes</option>
            {handshakes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.clientId} · {h.architect.email}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          <button
            onClick={() => setView('timeline')}
            className={`px-3 py-1.5 text-sm font-medium ${view === 'timeline' ? 'bg-cidco-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Timeline
          </button>
          <button
            onClick={() => setView('table')}
            className={`border-l border-slate-300 px-3 py-1.5 text-sm font-medium ${view === 'table' ? 'bg-cidco-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Table
          </button>
        </div>
        <span className="text-xs text-slate-400">{logs.length} entr{logs.length === 1 ? 'y' : 'ies'}{live ? ' · live' : ''}</span>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {/* Timeline view */}
      {view === 'timeline' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {selected && (
            <p className="mb-4 text-sm text-slate-500">
              Handshake <span className="font-mono text-slate-700">{selected.clientId}</span> · {selected.architect.email}
            </p>
          )}
          {loading && logs.length === 0 ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <HandshakeTimeline logs={logs} />
          )}
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Direction</th>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Code</th>
                  <th className="px-5 py-3 font-medium">Client / Architect</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                  <th className="px-5 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && logs.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">No communication yet.</td></tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-500">{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                      <td className="px-5 py-3 text-xs">
                        <span className={l.direction === 'ARCHITECT_TO_ADMIN' ? 'text-blue-700' : 'text-slate-600'}>
                          {l.direction === 'ARCHITECT_TO_ADMIN' ? 'Architect → CIDCO' : 'CIDCO → Architect'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${EVENT_STYLE[l.event] ?? 'bg-slate-100 text-slate-700'}`}>
                          {l.event}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">{l.statusCode ?? '—'}</td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {l.handshake ? (
                          <>
                            <span className="font-mono">{l.handshake.clientId}</span>
                            <span className="block text-slate-400">{l.handshake.architect.email}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{l.ip ?? '—'}</td>
                      <td className="max-w-md truncate px-5 py-3 text-xs text-slate-600" title={l.detail ?? ''}>{l.detail}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
