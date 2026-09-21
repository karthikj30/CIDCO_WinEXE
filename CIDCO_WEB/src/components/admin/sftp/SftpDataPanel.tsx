'use client';

import { useCallback, useEffect, useState } from 'react';
import { readJson } from '@/lib/fetchJson';

/**
 * The DATA table, browsed as the folder tree it is stored in:
 *
 *   <companyId>/<dd_mm_yyyy>/<hh-mm-ss>.csv
 *
 * Each company node carries its MASTER row, so an officer reads the
 * registration and everything delivered under it in one place.
 */
type DataFile = {
  id: string;
  fileName: string;
  /** The flat name the agent delivered it under, before poll1 filed it. */
  deliveredName: string | null;
  relativePath: string;
  sizeBytes: number;
  rowCount: number;
  importedCount: number;
  sourceIp: string | null;
  receivedAt: string;
  timestamp: string | null;
  pollStatus: string;
  fileStatus: string | null;
};

type Node = {
  company: {
    id: string;
    companyId: string;
    companyName: string;
    architectServerIp: string;
    filePath: string;
    publicKey: string | null;
    userId: string | null;
    contactEmail: string | null;
    active: boolean;
    createdAt: string;
  };
  fileCount: number;
  days: Array<{ dateFolder: string; files: DataFile[] }>;
};

const fmt = (d: string) => new Date(d).toLocaleString('en-IN');
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export default function SftpDataPanel() {
  const [tree, setTree] = useState<Node[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCompany, setOpenCompany] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/data');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setTree(json.data.tree);
      setTotal(json.data.totalFiles);
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
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Data</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every CSV CIDCO has accepted, filed as{' '}
            <code className="rounded bg-slate-100 px-1 font-mono text-xs">companyId / dd_mm_yyyy / hh-mm-ss.csv</code>.
            Poll2 writes the AQI SFTP Ingestion Service status on each file.
          </p>
        </div>
        <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!loading && <p className="text-xs text-slate-500">{total} file{total === 1 ? '' : 's'} stored.</p>}

      {loading && tree.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : tree.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No companies registered yet.
        </div>
      ) : (
        <div className="space-y-3">
          {tree.map((node) => {
            const isOpen = openCompany === node.company.companyId;
            return (
              <div key={node.company.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  onClick={() => setOpenCompany(isOpen ? null : node.company.companyId)}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-slate-50"
                >
                  <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-semibold text-slate-900">{node.company.companyName}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                    {node.company.companyId}
                  </span>
                  {!node.company.active && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">INACTIVE</span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">
                    {node.fileCount} file{node.fileCount === 1 ? '' : 's'}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
                    {/* The master row */}
                    <dl className="grid gap-3 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-slate-500">User ID</dt>
                        <dd className="mt-0.5 font-mono text-slate-900">{node.company.userId ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-slate-500">Public key</dt>
                        <dd className="mt-0.5 break-all font-mono text-slate-900">
                          {node.company.publicKey ? `${node.company.publicKey.slice(0, 24)}…` : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-slate-500">Architect server IP</dt>
                        <dd className="mt-0.5 font-mono text-slate-900">{node.company.architectServerIp}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-slate-500">Registered file path</dt>
                        <dd className="mt-0.5 break-all font-mono text-slate-900">{node.company.filePath || '(none — poll1 creates tree)'}</dd>
                      </div>
                    </dl>

                    {node.days.length === 0 ? (
                      <p className="mt-4 text-xs text-slate-500">Nothing delivered under this company yet.</p>
                    ) : (
                      <div className="mt-4 space-y-2">
                        {node.days.map((day) => {
                          const key = `${node.company.companyId}/${day.dateFolder}`;
                          const dayOpen = openMonth === key;
                          return (
                            <div key={key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                              <button
                                onClick={() => setOpenMonth(dayOpen ? null : key)}
                                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-slate-50"
                              >
                                <span className="text-slate-400">{dayOpen ? '▾' : '▸'}</span>
                                <span className="text-slate-400">📁</span>
                                <span className="font-mono font-medium text-slate-800">{day.dateFolder}</span>
                                <span className="ml-auto text-slate-500">
                                  {day.files.length} file{day.files.length === 1 ? '' : 's'}
                                </span>
                              </button>

                              {dayOpen && (
                                <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                                  <ul className="space-y-2">
                                    {day.files.map((f) => (
                                      <li key={f.id} className="space-y-1 text-xs">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-slate-400">📄</span>
                                          <span className="font-mono text-slate-800">{f.fileName}</span>
                                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-slate-600">
                                            {f.pollStatus}
                                          </span>
                                          <span className="text-slate-400">{kb(f.sizeBytes)}</span>
                                          <span
                                            className={
                                              f.importedCount < f.rowCount
                                                ? 'font-semibold text-amber-700'
                                                : 'text-slate-500'
                                            }
                                          >
                                            {f.importedCount} of {f.rowCount} rows stored
                                            {f.importedCount < f.rowCount
                                              ? ` · ${f.rowCount - f.importedCount} rejected`
                                              : ''}
                                          </span>
                                          <span className="text-slate-400">from {f.sourceIp ?? '—'}</span>
                                          <span className="text-slate-400">{fmt(f.receivedAt)}</span>
                                          <a
                                            href={`/api/admin/sftp/data/${f.id}/download`}
                                            className="font-semibold text-violet-700 hover:underline"
                                          >
                                            Download
                                          </a>
                                        </div>
                                        {f.deliveredName && (
                                          <p className="ml-5 font-mono text-[10px] text-slate-400">
                                            delivered as {f.deliveredName}
                                          </p>
                                        )}
                                        {f.fileStatus && (
                                          <pre className="ml-5 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-700">
                                            {f.fileStatus}
                                          </pre>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
