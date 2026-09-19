'use client';

import { useState } from 'react';
import CopyField from '../admin/CopyField';
import type { MeData } from './ArchitectWorkspace';
import { fmt, type StoredTokens } from './useTokens';

const KIND_LABEL: Record<string, string> = {
  INITIAL_PAIR: 'Validation result',
  ACCESS_RENEWAL: 'New access token',
  FULL_REISSUE: 'New token pair',
};

// The endpoints CIDCO sends with the tokens, in the order the architect uses them.
const ENDPOINT_LABEL: Array<[string, string]> = [
  ['sendDataUrl', 'Send AQI data (POST)'],
  ['requestTokenUrl', 'Request a new access token (POST)'],
  ['validateUrl', 'Validate credentials (POST)'],
  ['logsUrl', 'My exchange log (GET)'],
  ['docsUrl', 'API documentation'],
];

/**
 * The endpoint URLs CIDCO delivered with the tokens. Each row copies on click
 * so the architect can paste it straight into Postman or their sender.
 */
function EndpointList({ endpoints }: { endpoints: Record<string, string> }) {
  const [copied, setCopied] = useState<string | null>(null);
  const rows = ENDPOINT_LABEL.filter(([key]) => endpoints[key]);
  if (rows.length === 0) return null;

  async function copy(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Your endpoints — copy these and start sending
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map(([key, label]) => (
          <li key={key} className="flex flex-wrap items-center gap-2">
            <span className="w-56 shrink-0 text-xs text-slate-600">{label}</span>
            <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">
              {endpoints[key]}
            </code>
            <button
              onClick={() => copy(key, endpoints[key])}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              {copied === key ? 'Copied ✓' : 'Copy'}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Send the access token as <code className="font-mono">Authorization: Bearer &lt;access token&gt;</code>.
        Full request and response formats are in the API documentation.
      </p>
    </div>
  );
}

export default function MessagesPanel({
  me,
  saveTokens,
  reload,
}: {
  me: MeData;
  saveTokens: (t: StoredTokens) => void;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const messages = me.handshakes
    .flatMap((h) => h.deliveries.map((d) => ({ ...d, clientId: h.clientId })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  /** Copies the delivered tokens into this browser's store in one click. */
  function useTokensFrom(d: (typeof messages)[number]) {
    saveTokens({
      clientId: d.clientId,
      ...(d.accessToken ? { accessToken: d.accessToken, accessExpiresAt: d.accessExpiresAt ?? undefined } : {}),
      ...(d.refreshToken ? { refreshToken: d.refreshToken, refreshExpiresAt: d.refreshExpiresAt ?? undefined } : {}),
    });
    setNotice('Tokens saved to this dashboard. Go to “Send AQI data” and click Automate.');
  }

  async function ack(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/architect/deliveries/${id}/ack`, { method: 'POST' });
      await reload();
      setNotice('Marked as saved — the tokens are no longer shown.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Messages from CIDCO</h2>
        <p className="mt-1 text-sm text-slate-500">
          When CIDCO validates your request or approves a token request, your tokens are delivered
          here. Save them, then use the access token on the <strong>Send AQI data</strong> tab.
        </p>
      </div>

      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {messages.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No messages yet. Submit your credentials on the <strong>Connection</strong> tab — CIDCO will
          send your tokens here once they approve you.
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((d) => {
            const hasTokens = !!(d.accessToken || d.refreshToken);
            return (
              <div
                key={d.id}
                className={`rounded-xl border p-5 shadow-sm ${
                  hasTokens ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                    {KIND_LABEL[d.kind] ?? d.kind}
                  </span>
                  <span className="font-mono text-xs text-slate-500">{d.clientId}</span>
                  <span className="ml-auto text-xs text-slate-400">{fmt(d.createdAt)}</span>
                </div>

                <p className={`mt-3 text-sm ${hasTokens ? 'font-medium text-emerald-900' : 'text-slate-700'}`}>
                  {d.message}
                </p>

                {hasTokens ? (
                  <div className="mt-4 space-y-2">
                    {d.accessToken && <CopyField label="Access token" value={d.accessToken} />}
                    {d.refreshToken && <CopyField label="Refresh token" value={d.refreshToken} />}
                    <p className="text-xs text-emerald-800">
                      Access expires {fmt(d.accessExpiresAt)}
                      {d.refreshExpiresAt ? ` · refresh expires ${fmt(d.refreshExpiresAt)}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => useTokensFrom(d)}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Use these tokens on this dashboard
                      </button>
                      <button
                        onClick={() => ack(d.id)}
                        disabled={busy === d.id}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {busy === d.id ? 'Saving…' : 'I have saved them'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    {d.acknowledgedAt
                      ? `Tokens saved ${fmt(d.acknowledgedAt)}${d.accessPrefix ? ` · access ${d.accessPrefix}…` : ''}`
                      : 'No tokens were issued with this message.'}
                  </p>
                )}

                {d.endpoints && <EndpointList endpoints={d.endpoints} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
