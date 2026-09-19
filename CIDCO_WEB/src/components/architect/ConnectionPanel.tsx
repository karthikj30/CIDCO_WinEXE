'use client';

import { useState } from 'react';
import { fmt, relativeTime, type StoredTokens } from './useTokens';
import type { MeData } from './ArchitectWorkspace';
import { readJson } from '@/lib/fetchJson';

function Badge({ status }: { status: string }) {
  const style: Record<string, string> = {
    PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
    AWAITING_APPROVAL: 'bg-blue-100 text-blue-800 border-blue-200',
    ESTABLISHED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
    EXPIRED: 'bg-amber-100 text-amber-800 border-amber-200',
    REVOKED: 'bg-red-100 text-red-800 border-red-200',
    APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style[status] ?? style.PENDING}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function ConnectionPanel({
  me,
  tokens,
  clearTokens,
  reload,
  goToMessages,
}: {
  me: MeData;
  tokens: StoredTokens;
  saveTokens: (t: StoredTokens) => void;
  clearTokens: () => void;
  reload: () => Promise<void>;
  goToMessages: () => void;
}) {
  const [clientId, setClientId] = useState(tokens.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [deviceInfo, setDeviceInfo] = useState('');
  const [paste, setPaste] = useState('');
  const [refreshInput, setRefreshInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hs = me.handshakes.find((h) => h.clientId === clientId) ?? me.handshakes[0] ?? null;
  const pendingValidation = hs?.validationRequests.find((v) => v.status === 'PENDING') ?? null;
  const pendingTokenReq = hs?.tokenRequests.find((t) => t.status === 'PENDING') ?? null;

  function applyPaste() {
    setError(null);
    try {
      const j = JSON.parse(paste);
      if (!j.clientId || !j.clientSecret) throw new Error('JSON must contain clientId and clientSecret');
      setClientId(j.clientId);
      setClientSecret(j.clientSecret);
      setNotice('Credential loaded — now click “Send to CIDCO for validation”.');
      setPaste('');
    } catch (err) {
      setError(`Could not read that JSON: ${(err as Error).message}`);
    }
  }

  async function submitValidation(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/architect/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          ...(ipAddress ? { ipAddress } : {}),
          ...(deviceInfo ? { deviceInfo } : {}),
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Validation failed');
      setClientSecret('');
      setNotice(json.data.message);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestAccessToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/architect/token-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshInput || tokens.refreshToken, reason: 'Access token expired' }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setRefreshInput('');
      setNotice(json.data.message);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accessDead = tokens.accessExpiresAt ? new Date(tokens.accessExpiresAt).getTime() <= Date.now() : false;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Connection</h2>
        <p className="mt-1 text-sm text-slate-500">
          Hit the CIDCO API with the user id and password CIDCO emailed you. CIDCO reviews your
          identity, IP address and device, and on approval sends your tokens to the{' '}
          <button onClick={goToMessages} className="font-semibold text-emerald-700 underline">Messages</button> tab.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {pendingValidation && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-semibold text-blue-900">Awaiting CIDCO approval</p>
          <p className="mt-1 text-sm text-blue-800">
            Sent {fmt(pendingValidation.createdAt)} from IP{' '}
            <span className="font-mono">{pendingValidation.presentedIp ?? 'unknown'}</span>
            {pendingValidation.deviceInfo ? ` · ${pendingValidation.deviceInfo}` : ''}. Your access and
            refresh tokens will appear under <strong>Messages</strong> once an officer approves.
          </p>
          <button onClick={() => void reload()} className="mt-3 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
            Check again
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Your tokens (this dashboard)</h3>
          {tokens.accessToken || tokens.refreshToken ? (
            <>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Access token</dt>
                  <dd className="font-mono text-slate-800">{tokens.accessToken?.slice(0, 18) ?? '—'}…</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Access expires</dt>
                  <dd className={accessDead ? 'font-semibold text-red-600' : 'text-slate-800'}>{relativeTime(tokens.accessExpiresAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Refresh token</dt>
                  <dd className="font-mono text-slate-800">{tokens.refreshToken?.slice(0, 18) ?? '—'}…</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Refresh expires</dt>
                  <dd className="text-slate-800">{relativeTime(tokens.refreshExpiresAt)}</dd>
                </div>
              </dl>
              <button onClick={() => { clearTokens(); setNotice('Tokens cleared from this dashboard.'); }}
                className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Forget tokens
              </button>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">
              No tokens yet — they arrive on the Messages tab after CIDCO approves you.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Handshake status (from CIDCO)</h3>
          {hs ? (
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Client ID</dt><dd className="font-mono text-slate-800">{hs.clientId}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Status</dt><dd><Badge status={hs.status} /></dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Whitelisted IP</dt><dd className="font-mono text-slate-800">{hs.whitelistedIp ?? '—'}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Device</dt><dd className="max-w-[55%] truncate text-right text-slate-800" title={hs.deviceInfo ?? ''}>{hs.deviceInfo ?? '—'}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Credential expires</dt><dd className="text-slate-800">{fmt(hs.credentialExpiresAt)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Token policy</dt><dd className="text-slate-800">{hs.accessTokenTtlDays}d access / {hs.refreshTokenTtlDays}d refresh</dd></div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-400">CIDCO has not issued you any credentials yet.</p>
          )}
        </div>
      </div>

      {/* Step 1 — first hit with user id + password */}
      <form onSubmit={submitValidation} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Hit the CIDCO API with your credentials</h3>
        <p className="mt-1 text-xs text-slate-500">
          Use this the first time, and again if <strong>both</strong> your tokens expire. Paste the JSON
          CIDCO emailed you, or type the values in.
        </p>

        <div className="mt-3 flex gap-2">
          <input value={paste} onChange={(e) => setPaste(e.target.value)}
            placeholder='Paste the credential JSON CIDCO emailed, e.g. {"clientId":"ARCH-…","clientSecret":"hs_sec_…"}'
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          <button type="button" onClick={applyPaste} disabled={!paste.trim()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Load
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="v-cid" className="mb-1 block text-xs font-medium text-slate-600">User ID (clientId) *</label>
            <input id="v-cid" value={clientId} onChange={(e) => setClientId(e.target.value)} required placeholder="ARCH-XXXXXXXXXXXX"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label htmlFor="v-sec" className="mb-1 block text-xs font-medium text-slate-600">Password (clientSecret) *</label>
            <input id="v-sec" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required placeholder="hs_sec_…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label htmlFor="v-ip" className="mb-1 block text-xs font-medium text-slate-600">
              IP address <span className="font-normal text-slate-400">(blank = this connection&rsquo;s IP)</span>
            </label>
            <input id="v-ip" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} placeholder="e.g. 203.0.113.9"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label htmlFor="v-dev" className="mb-1 block text-xs font-medium text-slate-600">Device info</label>
            <input id="v-dev" value={deviceInfo} onChange={(e) => setDeviceInfo(e.target.value)} placeholder="RaspberryPi-4 | station STN-KHR-07"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
        </div>

        <button type="submit" disabled={busy || !!pendingValidation}
          className="mt-4 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Sending…' : pendingValidation ? 'Awaiting CIDCO approval' : 'Send to CIDCO for validation'}
        </button>
      </form>

      {/* Step 2 — access token renewal with the refresh token */}
      <form onSubmit={requestAccessToken} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Request a new access token</h3>
        <p className="mt-1 text-xs text-slate-500">
          Use this when your access token expires. Send the refresh token CIDCO gave you — an officer
          verifies it and the new access token arrives under <strong>Messages</strong>.
        </p>

        {pendingTokenReq ? (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Request sent {fmt(pendingTokenReq.requestedAt)} — awaiting CIDCO approval.
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={refreshInput} onChange={(e) => setRefreshInput(e.target.value)}
              placeholder={tokens.refreshToken ? `Using saved refresh token ${tokens.refreshToken.slice(0, 16)}…` : 'cidco_ref_…'}
              className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
            <button type="submit" disabled={busy || (!refreshInput && !tokens.refreshToken)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              Request access token
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
