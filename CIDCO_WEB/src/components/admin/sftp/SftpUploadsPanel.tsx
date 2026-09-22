'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson } from '@/lib/fetchJson';

type Row = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  mode: string;
  sheetName: string | null;
  rowCount: number;
  importedCount: number;
  failedCount: number;
  receivedAt: string;
  parsedAt: string | null;
  presentedSiteName: string | null;
  presentedPath: string | null;
  siteNameMatch: boolean;
  pathMatch: boolean;
  validationPassed: boolean;
  rejectionReason: string | null;
  handshake: {
    id: string;
    clientId: string;
    architect: { id: string; name: string; email: string; firmName: string | null };
    company: { siteName: string } | null;
  };
};

/** One field of the check: what arrived, what CIDCO registered, did it match. */
type Field = { presented: string | null; expected: string | null; match: boolean };

type Detail = Row & {
  storedName: string;
  columns: Array<{ label: string; key: string }>;
  rows: Array<Record<string, unknown>>;
  errors: Array<{ row: number; error: string }>;
  validation: {
    passed: boolean;
    reason: string | null;
    siteName: Field;
    designatedPath: Field;
  };
  handshake: Row['handshake'] & { whitelistedIp: string | null };
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

const UPLOAD_STATUS: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700 border-slate-200',
  PARSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  PARTIAL: 'bg-amber-100 text-amber-800 border-amber-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
};

/**
 * The validation CIDCO ran on this transfer, field by field: what the transfer
 * presented against what CIDCO registered for the company beforehand.
 */
function ValidationTable({ validation }: { validation: Detail['validation'] }) {
  const rows: Array<[string, Field]> = [
    ['Company id', validation.siteName],
    ['Designated path', validation.designatedPath],
  ];
  return (
    <div
      className={`overflow-hidden rounded-lg border ${
        validation.passed ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className={`text-xs font-bold uppercase tracking-wide ${validation.passed ? 'text-emerald-800' : 'text-red-800'}`}>
          {validation.passed ? 'Validation passed — data stored' : 'Validation failed — nothing stored'}
        </span>
      </div>
      <table className="w-full text-left text-xs">
        <thead className="bg-white/60 uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Field</th>
            <th className="px-4 py-2 font-medium">Incoming</th>
            <th className="px-4 py-2 font-medium">Registered by CIDCO</th>
            <th className="px-4 py-2 font-medium">Match</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/70">
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td className="px-4 py-2 font-medium text-slate-700">{label}</td>
              <td className="break-all px-4 py-2 font-mono text-slate-900">{f.presented ?? '—'}</td>
              <td className="break-all px-4 py-2 font-mono text-slate-600">{f.expected ?? '—'}</td>
              <td className="px-4 py-2">
                {f.match ? (
                  <span className="font-semibold text-emerald-700">✓ match</span>
                ) : (
                  <span className="font-semibold text-red-700">✕ mismatch</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {validation.reason && <p className="px-4 py-2.5 text-xs text-red-900">{validation.reason}</p>}
    </div>
  );
}

function UploadBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        UPLOAD_STATUS[status] ?? 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {status}
    </span>
  );
}

/** Renders whatever a sheet cell held, without pretending to know its type. */
function cell(value: unknown) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-300">—</span>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function SftpUploadsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/uploads');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.uploads);
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

  // Uploads arrive over SFTP, outside the browser, so poll for new ones.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live) timer.current = setInterval(() => void load(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, load]);

  const open = useCallback(async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/sftp/uploads/${id}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load the sheet');
      setDetail(json.data.upload);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [openId]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Delivered transfers</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every file architects have sent over SFTP. Each one is validated against the company CIDCO
            registered — company id, server address and file path — and only stored if all three match.
            Open a transfer to see that comparison and preview the file as it arrived.
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

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          <p>
            Nothing has arrived through <strong>CIDCO&apos;s own SFTP intake</strong> yet. Transfers
            appear here the moment an architect sends a file to it.
          </p>
          {/*
            This page only ever shows what CIDCO's intake received. An agent
            that uploads to a plain SFTP folder on this server is picked up by
            the poll worker instead, and lands under Data — so a working setup
            can leave this page empty for good, and saying only "nothing
            delivered yet" reads like the data never arrived.
          */}
          <p className="text-xs">
            Files the architect uploads to a plain SFTP folder on this server do not appear here.
            Those are picked up by the poll worker and are listed under{' '}
            <strong>Data</strong>, with their ingestion status.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((u) => (
            <div key={u.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{u.fileName}</span>
                    <UploadBadge status={u.status} />
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {u.mode === 'PORTAL' ? 'portal' : 'sftp'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {u.handshake.company?.siteName ?? u.handshake.architect.name} ·{' '}
                    <span className="font-mono">{u.presentedSiteName ?? u.handshake.clientId}</span> ·{' '}
                    {kb(u.sizeBytes)} · {fmt(u.receivedAt)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    <span className={u.siteNameMatch ? 'text-emerald-700' : 'text-red-700'}>
                      {u.siteNameMatch ? '✓' : '✕'} company id
                    </span>
                    <span className={u.pathMatch ? 'text-emerald-700' : 'text-red-700'}>
                      {u.pathMatch ? '✓' : '✕'} file path
                    </span>
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  {u.validationPassed ? (
                    <>
                      <p>
                        <span className="font-semibold text-slate-900">{u.importedCount}</span> of {u.rowCount} rows stored
                      </p>
                      {u.failedCount > 0 && <p className="text-amber-700">{u.failedCount} rejected</p>}
                    </>
                  ) : (
                    <p className="font-semibold text-red-700">refused — nothing stored</p>
                  )}
                </div>
                <button
                  onClick={() => open(u.id)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {openId === u.id ? 'Close' : 'Open'}
                </button>
              </div>

              {openId === u.id && (
                <div className="border-t border-slate-200 bg-slate-50 p-5">
                  {!detail ? (
                    <p className="text-sm text-slate-500">Loading the sheet…</p>
                  ) : (
                    <div className="space-y-4">
                      <ValidationTable validation={detail.validation} />

                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                        <span>
                          Sheet: <span className="font-medium text-slate-900">{detail.sheetName ?? '—'}</span>
                        </span>
                        <span>
                          Stored as <span className="font-mono">{detail.storedName}</span>
                        </span>
                        <span>Parsed {fmt(detail.parsedAt)}</span>
                        <span>Arrived by {detail.mode === 'PORTAL' ? 'the architect portal' : 'direct SFTP'}</span>
                      </div>

                      {detail.errors.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                            Rows CIDCO could not store
                          </p>
                          <ul className="mt-2 space-y-1 text-xs text-amber-900">
                            {detail.errors.map((e) => (
                              <li key={e.row}>
                                <span className="font-semibold">Row {e.row}</span> — {e.error}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {!detail.validation.passed ? (
                        <p className="text-sm text-slate-500">
                          The file was refused before it was read, so there is nothing to preview.
                        </p>
                      ) : detail.rows.length === 0 ? (
                        <p className="text-sm text-slate-500">The file had no data rows.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="whitespace-nowrap px-3 py-2 font-medium">Row</th>
                                {detail.columns.map((c) => (
                                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                                    {c.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detail.rows.map((row, i) => {
                                const rowNo = i + 2;
                                const bad = detail.errors.some((e) => e.row === rowNo);
                                return (
                                  <tr key={rowNo} className={bad ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                                    <td className="whitespace-nowrap px-3 py-2 text-slate-400">{rowNo}</td>
                                    {detail.columns.map((c) => (
                                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-800">
                                        {cell(row[c.key])}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
