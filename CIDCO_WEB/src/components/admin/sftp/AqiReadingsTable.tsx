'use client';

import { useCallback, useEffect, useState } from 'react';
import { readJson } from '@/lib/fetchJson';

/**
 * Every reading CIDCO holds for one company, as a table, with the parameters
 * each reading is missing named on its own row.
 *
 * The file tree answers "what was delivered". This answers "what is in it" —
 * the question a blank cell makes you ask, and one the tree cannot answer
 * because a file can be perfectly valid and still be full of gaps.
 */

type Parameter = { key: string; label: string; required: boolean; numeric: boolean };

type Row = {
  id: string;
  fileName: string;
  deliveredName: string | null;
  dateFolder: string;
  sheetRow: number;
  values: Record<string, string | null>;
  missing: string[];
  missingRequired: boolean;
};

type Gap = { key: string; label: string; missing: number };

type Props = { companyId: string; companyName: string };

const MAX_CELL = 22;
const short = (v: string) => (v.length > MAX_CELL ? `${v.slice(0, MAX_CELL - 1)}…` : v);

export default function AqiReadingsTable({ companyId, companyName }: Props) {
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [complete, setComplete] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sftp/data/rows?companyId=${encodeURIComponent(companyId)}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load readings');
      setParameters(json.data.parameters);
      setRows(json.data.rows);
      setGaps(json.data.gaps);
      setComplete(json.data.complete);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = onlyGaps ? rows.filter((r) => r.missing.length > 0) : rows;
  const withGaps = rows.length - complete;

  if (loading && rows.length === 0) return <p className="text-sm text-slate-500">Loading readings…</p>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Nothing has been ingested for {companyName} yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-slate-700">
          {rows.length} reading{rows.length === 1 ? '' : 's'}
        </span>
        <span className="text-emerald-700">{complete} complete</span>
        {withGaps > 0 && (
          <span className="font-semibold text-amber-700">{withGaps} with missing parameters</span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-slate-600">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
          Only rows with something missing
        </label>
      </div>

      {gaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px]">
          <span className="font-semibold text-amber-900">Missing across these readings:</span>
          {gaps.map((g) => (
            <span key={g.key} className="rounded bg-white px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">
              {g.label} · {g.missing}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-[11px]">
          <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-2 py-2 font-semibold">File · row</th>
              {parameters.map((p) => (
                <th
                  key={p.key}
                  className={`whitespace-nowrap px-2 py-2 font-semibold ${p.required ? 'text-slate-800' : ''}`}
                  title={p.required ? 'Required — a reading cannot be stored without it' : undefined}
                >
                  {p.label}
                  {p.required && <span className="ml-0.5 text-rose-500">*</span>}
                </th>
              ))}
              <th className="sticky right-0 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-2 py-2 font-semibold">
                Missing parameters
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((row) => (
              <tr key={row.id} className={row.missingRequired ? 'bg-rose-50/60' : undefined}>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-500">
                  {row.dateFolder}/{row.fileName} · r{row.sheetRow}
                </td>

                {parameters.map((p) => {
                  const value = row.values[p.key];
                  if (value === null) {
                    return (
                      <td
                        key={p.key}
                        className={`px-2 py-1.5 font-semibold ${p.required ? 'text-rose-600' : 'text-amber-600'}`}
                        title={`${p.label} is missing`}
                      >
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={p.key} className={`whitespace-nowrap px-2 py-1.5 text-slate-700 ${p.numeric ? 'tabular-nums' : ''}`} title={value}>
                      {short(value)}
                    </td>
                  );
                })}

                <td
                  className={`sticky right-0 border-l border-slate-200 px-2 py-1.5 ${
                    row.missingRequired ? 'bg-rose-50' : 'bg-white'
                  }`}
                >
                  {row.missing.length === 0 ? (
                    <span className="font-medium text-emerald-700">Complete</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {row.missing.map((key) => {
                        const p = parameters.find((x) => x.key === key);
                        return (
                          <span
                            key={key}
                            className={`rounded px-1 py-0.5 font-medium ring-1 ${
                              p?.required
                                ? 'bg-rose-100 text-rose-800 ring-rose-200'
                                : 'bg-amber-100 text-amber-800 ring-amber-200'
                            }`}
                          >
                            {p?.label ?? key}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        <span className="font-semibold text-rose-600">*</span> required — a reading missing one of these was rejected
        and never stored. Everything else missing is stored as null.
      </p>
    </div>
  );
}
