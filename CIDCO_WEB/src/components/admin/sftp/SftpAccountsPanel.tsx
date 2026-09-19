'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '../CopyField';
import { readJson } from '@/lib/fetchJson';

type Account = {
  id: string;
  username: string;
  passwordPrefix: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  company: {
    id: string;
    companyId: string;
    companyName: string;
    architectServerIp: string;
    filePath: string;
    contactEmail: string | null;
    active: boolean;
  } | null;
  uploadCount: number;
  lastUpload: { receivedAt: string; status: string; validationPassed: boolean } | null;
  createdAt: string;
};

type Endpoint = { designatedIp: string; port: number; fileTypes: string };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');

/**
 * The credentials CIDCO has issued. Issuing happens on the Companies tab,
 * against a registration — this is the ledger of what is out there.
 */
export default function SftpAccountsPanel() {
  const [rows, setRows] = useState<Account[]>([]);
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/accounts');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.accounts);
      setEndpoint(json.data.endpoint);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">SFTP accounts</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every SFTP user id CIDCO has issued, and the company registration it is tied to. New
            credentials are issued from the <strong>Companies</strong> tab.
          </p>
        </div>
        <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {endpoint && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <p className="font-semibold">Designated address architects send to</p>
          <p className="mt-1 font-mono text-xs">
            {endpoint.designatedIp}:{endpoint.port} · {endpoint.fileTypes}
          </p>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">SFTP user id</th>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Accepted from</th>
                <th className="px-5 py-3 font-medium">File path</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Transfers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    No SFTP credentials issued yet. Register a company, then issue its credentials.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">{a.username}</td>
                    <td className="px-5 py-3">
                      {a.company ? (
                        <>
                          <p className="font-medium text-slate-900">{a.company.companyName}</p>
                          <p className="font-mono text-xs text-slate-500">{a.company.companyId}</p>
                        </>
                      ) : (
                        <span className="text-xs text-amber-700">no registration — transfers are refused</span>
                      )}
                      {a.company?.contactEmail && <p className="text-xs text-slate-400">{a.company.contactEmail}</p>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{a.company?.architectServerIp ?? '—'}</td>
                    <td className="px-5 py-3 break-all font-mono text-xs text-slate-600">{a.company?.filePath ?? '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {a.uploadCount === 0 ? (
                        <span className="text-slate-400">none</span>
                      ) : (
                        <>
                          {a.uploadCount}
                          {a.lastUpload && (
                            <span className="block text-slate-400">last {fmt(a.lastUpload.receivedAt)}</span>
                          )}
                        </>
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
