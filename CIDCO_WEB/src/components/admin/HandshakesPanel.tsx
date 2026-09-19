'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import CopyField, { StatusBadge } from './CopyField';
import HandshakeTimeline from './HandshakeTimeline';
import { readJson } from '@/lib/fetchJson';

type Handshake = {
  id: string;
  clientId: string;
  secretPrefix: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  architect: { name: string; email: string; firmName: string | null };
  tokenCount: number;
  tokenRequestCount: number;
  activeToken: { prefix: string; expiresAt: string } | null;
  createdAt: string;
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString('en-IN') : '—';
}

export default function HandshakesPanel() {
  const [rows, setRows] = useState<Handshake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [architectEmail, setArchitectEmail] = useState('architect@example.com');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/handshakes');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.handshakes);
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCredential(null);
    try {
      const res = await fetch('/api/admin/handshakes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ architectEmail, expiresInDays: Number(expiresInDays) }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to issue credentials');
      setCredential(JSON.stringify(json.data.credential, null, 2));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Architect handshakes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Issue credentials to an architect, then watch the handshake move to ESTABLISHED once they
          validate. Generate API tokens for established handshakes.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {/* Issue new credentials */}
      <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Issue new handshake credentials</h3>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="hs-email" className="mb-1 block text-sm font-medium text-slate-700">Architect email</label>
            <input
              id="hs-email"
              type="email"
              value={architectEmail}
              onChange={(e) => setArchitectEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
            />
          </div>
          <div className="w-40">
            <label htmlFor="hs-days" className="mb-1 block text-sm font-medium text-slate-700">Credential expiry (days)</label>
            <input
              id="hs-days"
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-cidco-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-cidco-700 disabled:opacity-50"
          >
            {creating ? 'Issuing…' : 'Issue credentials'}
          </button>
        </div>

        {credential && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-emerald-800">
              Send this JSON to the architect — the secret is shown only once.
            </p>
            <CopyField label="Credential payload" value={credential} />
          </div>
        )}
      </form>

      {/* Handshake list */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Client ID</th>
                <th className="px-5 py-3 font-medium">Architect</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Active token</th>
                <th className="px-5 py-3 font-medium">Credential expiry</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No handshakes yet. Issue one above.</td></tr>
              ) : (
                rows.map((h) => (
                  <Fragment key={h.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">{h.clientId}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{h.architect.name}</p>
                        <p className="text-xs text-slate-500">{h.architect.email}</p>
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={h.status} /></td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {h.activeToken ? (
                          <span className="font-mono">{h.activeToken.prefix}… <span className="text-slate-400">exp {fmt(h.activeToken.expiresAt)}</span></span>
                        ) : (
                          <span className="text-slate-400">none</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">{fmt(h.credentialExpiresAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setOpenId(openId === h.id ? null : h.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {openId === h.id ? 'Close' : 'Manage'}
                        </button>
                      </td>
                    </tr>
                    {openId === h.id && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-5 py-4">
                          <HandshakeDetail handshakeId={h.id} clientId={h.clientId} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Detail / management for one handshake ---------------------------------

type Detail = {
  architect: {
    id: string; name: string; email: string; firmName: string | null;
    councilRegNo: string | null; phone: string | null; designation: string | null;
    address: string | null; accountSetupAt: string | null;
  };
  status: string;
  establishedAt: string | null;
  architectValidatedAt: string | null;
  credentialExpiresAt: string;
  whitelistedIp: string | null;
  deviceInfo: string | null;
  whitelistedAt: string | null;
  enforceWhitelist: boolean;
  accessTokenTtlDays: number;
  refreshTokenTtlDays: number;
  tokens: Array<{
    id: string; prefix: string; expiresAt: string; refreshPrefix: string | null;
    refreshExpiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null;
    active: boolean; refreshExpired: boolean;
  }>;
  tokenRequests: Array<{ id: string; status: string; reason: string | null; requestedAt: string }>;
  commLogs: Array<{ id: string; direction: string; event: string; statusCode: number | null; detail: string | null; ip: string | null; createdAt: string }>;
};

/** datetime-local needs `YYYY-MM-DDTHH:mm` in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HandshakeDetail({ handshakeId, clientId, onChanged }: { handshakeId: string; clientId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  // Which token(s) CIDCO wants to generate, and what came back.
  const [mode, setMode] = useState<'both' | 'access' | 'refresh'>('both');
  const [freshPair, setFreshPair] = useState<{ access: string | null; refresh: string | null } | null>(null);
  // Read after mount so server and client markup match.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  // policy + expiry editors
  const [accessTtl, setAccessTtl] = useState('7');
  const [refreshTtl, setRefreshTtl] = useState('30');
  const [enforce, setEnforce] = useState(true);
  const [accessExp, setAccessExp] = useState('');
  const [refreshExp, setRefreshExp] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/handshakes/${handshakeId}`);
    const json = await readJson(res);
    if (res.ok) {
      const d: Detail = json.data.handshake;
      setDetail(d);
      setAccessTtl(String(d.accessTokenTtlDays));
      setRefreshTtl(String(d.refreshTokenTtlDays));
      setEnforce(d.enforceWhitelist);
      const live = d.tokens.find((t) => !t.revokedAt);
      setAccessExp(toLocalInput(live?.expiresAt ?? null));
      setRefreshExp(toLocalInput(live?.refreshExpiresAt ?? null));
    }
  }, [handshakeId]);

  useEffect(() => { void load(); }, [load]);

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/admin/handshakes/${handshakeId}/policy`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessTokenTtlDays: Number(accessTtl),
          refreshTokenTtlDays: Number(refreshTtl),
          enforceWhitelist: enforce,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not save policy');
      setNotice('Token policy saved — applies to the next token issued.');
      await load(); onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function saveExpiry(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/admin/handshakes/${handshakeId}/token-expiry`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessExpiresAt: accessExp ? new Date(accessExp).toISOString() : undefined,
          refreshExpiresAt: refreshExp ? new Date(refreshExp).toISOString() : undefined,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not update expiry');
      setNotice('Live token expiry updated.');
      await load(); onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function resetWhitelist() {
    if (!confirm('Clear the whitelisted IP/device? The next validate will register a new one.')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/admin/handshakes/${handshakeId}/whitelist`, { method: 'DELETE' });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not reset whitelist');
      setNotice('Whitelist cleared.');
      await load(); onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function generateToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFreshPair(null);
    try {
      const res = await fetch(`/api/admin/handshakes/${handshakeId}/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret: secret,
          mode,
          expiresInDays: Number(accessTtl),
          refreshExpiresInDays: Number(refreshTtl),
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Token generation failed');
      setFreshPair({ access: json.data.token.accessToken, refresh: json.data.token.refreshToken });
      setNotice(json.data.message);
      setSecret('');
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('Revoke this handshake and invalidate all its tokens?')) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/handshakes/${handshakeId}/revoke`, { method: 'POST' });
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-500">Loading detail…</p>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>}

      {/* What the architect entered when they set up their own login */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Architect details</h4>
          <p className="text-xs text-slate-500">
            {detail.architect.accountSetupAt
              ? `Entered by the architect ${fmt(detail.architect.accountSetupAt)}`
              : 'The architect has not set up their own login yet — these are the placeholder details.'}
          </p>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          {(
            [
              ['Name', detail.architect.name],
              ['Username (email)', detail.architect.email],
              ['Firm', detail.architect.firmName],
              ['COA reg. no.', detail.architect.councilRegNo],
              ['Phone', detail.architect.phone],
              ['Designation', detail.architect.designation],
              ['Address', detail.architect.address],
            ] as Array<[string, string | null]>
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-slate-900">{value || <span className="text-slate-400">—</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Token expiry policy + IP whitelist */}
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={savePolicy} className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">Token expiry policy</h4>
          <p className="mt-1 text-xs text-slate-500">
            CIDCO sets the validity windows here. Saved to the backend and used by the API for every
            token issued afterwards (validate, refresh and the button below).
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`atl-${handshakeId}`} className="mb-1 block text-xs font-medium text-slate-600">Access token (days)</label>
              <input id={`atl-${handshakeId}`} type="number" min={1} value={accessTtl} onChange={(e) => setAccessTtl(e.target.value)}
                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={`rtl-${handshakeId}`} className="mb-1 block text-xs font-medium text-slate-600">Refresh token (days)</label>
              <input id={`rtl-${handshakeId}`} type="number" min={1} value={refreshTtl} onChange={(e) => setRefreshTtl(e.target.value)}
                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} className="rounded border-slate-300" />
              Enforce IP whitelist
            </label>
            <button type="submit" disabled={busy} className="ml-auto rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cidco-700 disabled:opacity-50">
              Save policy
            </button>
          </div>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Whitelisted IP / device</h4>
              <p className="mt-1 text-xs text-slate-500">Registered on the architect&rsquo;s first validate.</p>
            </div>
            <button onClick={resetWhitelist} disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Reset
            </button>
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">IP address</dt>
              <dd className="font-mono text-slate-800">{detail.whitelistedIp ?? <span className="text-slate-400">not registered</span>}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Device info</dt>
              <dd className="max-w-[60%] truncate text-right text-slate-800" title={detail.deviceInfo ?? ''}>{detail.deviceInfo ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Whitelisted at</dt>
              <dd className="text-slate-800">{fmt(detail.whitelistedAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Enforcement</dt>
              <dd className={detail.enforceWhitelist ? 'font-semibold text-emerald-700' : 'text-amber-700'}>
                {detail.enforceWhitelist ? 'ON' : 'OFF'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Generate token pair */}
        <form onSubmit={generateToken} className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">Generate tokens</h4>
          <p className="mt-1 text-xs text-slate-500">
            Requires the handshake to be ESTABLISHED. Paste the clientSecret you issued. Uses the
            policy above ({accessTtl}d access / {refreshTtl}d refresh).
          </p>

          {/* Which token(s) to generate */}
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">Token to generate</span>
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-slate-300">
              {([
                { key: 'both', label: 'Both' },
                { key: 'access', label: 'Access only' },
                { key: 'refresh', label: 'Refresh only' },
              ] as const).map((opt, i) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMode(opt.key)}
                  className={`px-2 py-1.5 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-slate-300' : ''} ${
                    mode === opt.key ? 'bg-cidco-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {mode === 'both'
                ? 'New access + refresh pair. Revokes any earlier pair — the architect must be given both.'
                : mode === 'access'
                  ? 'New access token only; the current refresh token keeps working.'
                  : 'New refresh token only; the current access token keeps working.'}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            <input value={clientId} readOnly className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600" />
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste clientSecret (hs_sec_…)"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
            />
            <button
              type="submit"
              disabled={busy || detail.status !== 'ESTABLISHED'}
              className="w-full rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cidco-700 disabled:opacity-50"
            >
              {busy ? 'Generating…' : mode === 'both' ? 'Generate both tokens' : mode === 'access' ? 'Generate access token' : 'Generate refresh token'}
            </button>
            {detail.status !== 'ESTABLISHED' && (
              <p className="text-xs text-amber-700">Waiting for the architect to validate — status is {detail.status}.</p>
            )}
          </div>

          {freshPair && (
            <div className="mt-3 space-y-2">
              {freshPair.access && <CopyField label="Access token (shown once)" value={freshPair.access} />}
              {freshPair.refresh && <CopyField label="Refresh token (shown once)" value={freshPair.refresh} />}
              <CopyField
                label="Both tokens as JSON — send to the architect"
                value={JSON.stringify(
                  {
                    ...(freshPair.access ? { accessToken: freshPair.access } : {}),
                    ...(freshPair.refresh ? { refreshToken: freshPair.refresh } : {}),
                    dataUrl: `${origin}/api/architect/data`,
                    refreshUrl: `${origin}/api/architect/refresh`,
                  },
                  null,
                  2,
                )}
              />
            </div>
          )}
        </form>

        {/* Summary + tokens */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900">Tokens</h4>
            <button onClick={revoke} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
              Revoke handshake
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Validated {fmt(detail.architectValidatedAt)} · established {fmt(detail.establishedAt)}</p>

          {/* Edit the live pair's expiry dates */}
          <form onSubmit={saveExpiry} className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Set expiry on the live token pair</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor={`ae-${handshakeId}`} className="mb-1 block text-[11px] text-slate-500">Access expires</label>
                <input id={`ae-${handshakeId}`} type="datetime-local" value={accessExp} onChange={(e) => setAccessExp(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
              </div>
              <div>
                <label htmlFor={`re-${handshakeId}`} className="mb-1 block text-[11px] text-slate-500">Refresh expires</label>
                <input id={`re-${handshakeId}`} type="datetime-local" value={refreshExp} onChange={(e) => setRefreshExp(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
              </div>
            </div>
            <button type="submit" disabled={busy}
              className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Update expiry
            </button>
          </form>

          <div className="mt-3 space-y-1">
            {detail.tokens.length === 0 && <p className="text-xs text-slate-400">No tokens yet.</p>}
            {detail.tokens.map((t) => (
              <div key={t.id} className="rounded border border-slate-100 px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-slate-700">{t.prefix}…</span>
                  <span className={t.active ? 'text-emerald-700' : 'text-slate-400'}>
                    {t.revokedAt ? 'revoked' : t.active ? `active · exp ${fmt(t.expiresAt)}` : `expired ${fmt(t.expiresAt)}`}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-500">{t.refreshPrefix ? `${t.refreshPrefix}…` : 'no refresh token'}</span>
                  <span className={t.refreshExpired ? 'text-red-600' : 'text-slate-500'}>
                    {t.refreshExpiresAt ? `refresh ${t.refreshExpired ? 'EXPIRED' : 'exp'} ${fmt(t.refreshExpiresAt)}` : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Full activity timeline for this handshake */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Handshake activity</h4>
            <p className="text-xs text-slate-500">Everything that happened, oldest first.</p>
          </div>
          <button
            onClick={() => load()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        <div className="max-h-96 overflow-auto pr-1">
          <HandshakeTimeline logs={detail.commLogs} />
        </div>
      </div>
    </div>
  );
}
