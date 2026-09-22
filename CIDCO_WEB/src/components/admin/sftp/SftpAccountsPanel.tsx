'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
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
  revokedAt: string | null;
  deliveryCount: number;
  lastDelivery: Delivery | null;
  deliveries: Delivery[];
};

/** One file this company has actually delivered. */
type Delivery = {
  companyId: string;
  fileName: string;
  deliveredName: string | null;
  relativePath: string;
  sizeBytes: number;
  rowCount: number;
  importedCount: number;
  pollStatus: string;
  sourceIp: string | null;
  receivedAt: string;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function setAccess(id: string, action: 'revoke' | 'grant') {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/sftp/accounts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not change access');
      setNotice(json.data.message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

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
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">SFTP user id</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Last delivery</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">Path delivered to</th>
                <th className="px-4 py-3 font-medium">Transfers</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                    No SFTP credentials issued yet. Register a company, then issue its credentials.
                  </td>
                </tr>
              ) : (
                rows.map((a) => {
                  const revoked = a.status === 'REVOKED';
                  const expanded = open === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr className={revoked ? 'bg-slate-50/70' : 'hover:bg-slate-50'}>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{a.username}</td>
                        <td className="px-4 py-3">
                          {a.company ? (
                            <>
                              <p className="font-medium text-slate-900">{a.company.companyName}</p>
                              <p className="font-mono text-xs text-slate-500">{a.company.companyId}</p>
                            </>
                          ) : (
                            <span className="text-xs text-amber-700">no registration</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {a.lastDelivery ? (
                            <>
                              <span className="text-slate-700">{fmt(a.lastDelivery.receivedAt)}</span>
                              <span className="block font-mono text-slate-400">
                                {a.lastDelivery.deliveredName ?? a.lastDelivery.fileName}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400">never</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {a.lastDelivery?.sourceIp ? (
                            a.lastDelivery.sourceIp
                          ) : (
                            /* A file dropped into a plain SFTP folder is
                               delivered by the operating system's own sshd;
                               the portal never sees the connection, so there
                               is no address to record. Saying so beats a bare
                               dash that reads like a bug. */
                            <span
                              className="text-slate-400"
                              title="Delivered over plain SFTP, so the portal never saw the connection. Only files sent to CIDCO's own intake carry a source address."
                            >
                              not seen ·{' '}
                              <span className="not-italic">{a.company?.architectServerIp || 'no IP registered'}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 break-all font-mono text-xs text-slate-600">
                          {a.lastDelivery?.relativePath ?? a.company?.filePath ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {a.deliveryCount === 0 ? (
                            <span className="text-slate-400">none</span>
                          ) : (
                            <>
                              <span className="font-semibold text-slate-800">{a.deliveryCount}</span> file
                              {a.deliveryCount === 1 ? '' : 's'}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              revoked ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {revoked ? 'REVOKED' : a.status}
                          </span>
                          {revoked && a.revokedAt && (
                            <span className="block text-[11px] text-slate-400">{fmt(a.revokedAt)}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            onClick={() => setOpen(expanded ? null : a.id)}
                            className="mr-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {expanded ? 'Hide' : 'Transactions'}
                          </button>
                          <button
                            onClick={() => setAccess(a.id, revoked ? 'grant' : 'revoke')}
                            disabled={busy === a.id}
                            className={`rounded-md px-2 py-1 text-xs font-semibold text-white disabled:opacity-50 ${
                              revoked ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                            }`}
                          >
                            {busy === a.id ? '…' : revoked ? 'Grant access' : 'Revoke access'}
                          </button>
                        </td>
                      </tr>

                      {expanded && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 px-4 py-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Last transactions · user id{' '}
                              <span className="font-mono normal-case text-slate-700">{a.username}</span> · company{' '}
                              <span className="font-mono normal-case text-slate-700">
                                {a.company?.companyId ?? '—'}
                              </span>
                            </p>
                            {a.deliveries.length === 0 ? (
                              <p className="text-xs text-slate-500">Nothing delivered on this account yet.</p>
                            ) : (
                              <table className="min-w-full text-xs">
                                <thead className="text-left uppercase tracking-wide text-slate-400">
                                  <tr>
                                    <th className="py-1 pr-4 font-semibold">Received</th>
                                    <th className="py-1 pr-4 font-semibold">Delivered as</th>
                                    <th className="py-1 pr-4 font-semibold">Filed at</th>
                                    <th className="py-1 pr-4 font-semibold">From</th>
                                    <th className="py-1 pr-4 font-semibold">Size</th>
                                    <th className="py-1 pr-4 font-semibold">Rows</th>
                                    <th className="py-1 font-semibold">Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {a.deliveries.map((d) => (
                                    <tr key={d.relativePath + d.receivedAt}>
                                      <td className="whitespace-nowrap py-1 pr-4 text-slate-600">{fmt(d.receivedAt)}</td>
                                      <td className="py-1 pr-4 font-mono text-slate-800">
                                        {d.deliveredName ?? d.fileName}
                                      </td>
                                      <td className="py-1 pr-4 font-mono text-slate-500">{d.relativePath}</td>
                                      <td className="py-1 pr-4 font-mono text-slate-500">{d.sourceIp ?? 'not seen'}</td>
                                      <td className="whitespace-nowrap py-1 pr-4 text-slate-500">{kb(d.sizeBytes)}</td>
                                      <td className="whitespace-nowrap py-1 pr-4 text-slate-600">
                                        {d.importedCount}/{d.rowCount}
                                      </td>
                                      <td className="py-1 text-slate-600">{d.pollStatus}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
