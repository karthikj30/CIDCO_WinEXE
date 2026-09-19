'use client';

import { useCallback, useEffect, useState } from 'react';
import CopyField, { StatusBadge } from './CopyField';
import { readJson } from '@/lib/fetchJson';

type Req = {
  id: string;
  status: string;
  reason: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  handshake: { clientId: string; status: string; architect: { name: string; email: string } };
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString('en-IN') : '—';
}

export default function TokenRequestsPanel() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('7');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; token: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/token-requests');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.tokenRequests);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    setIssued(null);
    try {
      const res = await fetch(`/api/admin/token-requests/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresInDays: Number(days) }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Approve failed');
      setIssued({ id, token: json.data.token.token });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Token requests</h2>
        <p className="mt-1 text-sm text-slate-500">
          Renewal requests raised by architects. Approve one to mint a fresh token ({pending} pending).
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-600">New token expiry on approval:</span>
        <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1" />
        <span className="text-slate-500">days</span>
      </div>

      {issued && (
        <CopyField label={`Token issued for request ${issued.id.slice(0, 8)}… (shown once)`} value={issued.token} />
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Requested</th>
                <th className="px-5 py-3 font-medium">Architect</th>
                <th className="px-5 py-3 font-medium">Client ID</th>
                <th className="px-5 py-3 font-medium">Reason</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No token requests yet.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-xs text-slate-600">{fmt(r.requestedAt)}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{r.handshake.architect.name}</p>
                      <p className="text-xs text-slate-500">{r.handshake.architect.email}</p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">{r.handshake.clientId}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{r.reason ?? '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {r.status === 'PENDING' ? (
                        <button
                          onClick={() => approve(r.id)}
                          disabled={busyId === r.id}
                          className="rounded-lg bg-cidco-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cidco-700 disabled:opacity-50"
                        >
                          {busyId === r.id ? 'Issuing…' : 'Approve & issue'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">resolved {fmt(r.resolvedAt)}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
