'use client';

import { useState } from 'react';

/** Renders a one-time secret (credential JSON, token) with a copy button. */
export default function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{label}</span>
        <button onClick={copy} className="text-xs font-semibold text-emerald-700 hover:underline">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-3 font-mono text-xs text-slate-800">
        {value}
      </pre>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
  ESTABLISHED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EXPIRED: 'bg-amber-100 text-amber-800 border-amber-200',
  REVOKED: 'bg-red-100 text-red-800 border-red-200',
  FULFILLED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {status}
    </span>
  );
}
