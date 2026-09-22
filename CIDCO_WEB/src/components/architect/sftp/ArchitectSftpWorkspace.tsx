'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ArchitectSignIn, { type Architect } from '../ArchitectSignIn';
import FileTransferPanes from './FileTransferPanes';
import { readJson } from '@/lib/fetchJson';

/**
 * The architect's SFTP workspace.
 *
 * Every architect signs in with the one portal login CIDCO issues, so the
 * session cannot say which company someone is. They connect the way they would
 * in WinSCP — designated address, SFTP user id, password — and that identifies
 * their company. From there: the registration every transfer is checked
 * against, a pair of file panes, and CIDCO's result for each transfer.
 */
export type Upload = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  mode: string;
  rowCount: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }> | null;
  receivedAt: string;
  parsedAt: string | null;
  presentedSiteName: string | null;
  presentedIp: string | null;
  presentedPath: string | null;
  siteNameMatch: boolean;
  ipMatch: boolean;
  pathMatch: boolean;
  validationPassed: boolean;
  rejectionReason: string | null;
};

type Company = {
  siteName: string;
  designatedPath: string;
  email: string | null;
  active: boolean;
};

type Account = {
  id: string;
  username: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  company: Company;
  uploads: Upload[];
  commLogs: Array<{
    id: string; direction: string; event: string; statusCode: number | null;
    detail: string | null; ip: string | null; createdAt: string;
  }>;
};

type Endpoint = { designatedIp: string; host: string; port: number; fileTypes: string; protocol: string };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const INPUT =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500';

export default function ArchitectSftpWorkspace() {
  const [architect, setArchitect] = useState<Architect | null>(null);
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [checking, setChecking] = useState(true);

  // Connection state — the SFTP credentials are the company's identity.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Confirms the portal session and picks up the designated address. */
  const loadSession = useCallback(async () => {
    const res = await fetch('/api/architect/sftp/me');
    if (!res.ok) return false;
    const json = await readJson(res);
    setArchitect((prev) => prev ?? { ...json.data.architect, role: 'ARCHITECT' });
    setEndpoint(json.data.endpoint);
    return true;
  }, []);

  useEffect(() => {
    (async () => {
      await loadSession();
      setChecking(false);
    })();
  }, [loadSession]);

  /** Connect, or refresh the connected account after a transfer. */
  const connect = useCallback(
    async (silent = false) => {
      if (!username || !password) return;
      if (!silent) {
        setConnecting(true);
        setError(null);
      }
      try {
        const res = await fetch('/api/architect/sftp/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const json = await readJson(res);
        if (!res.ok) {
          if (!silent) setError(json.error ?? 'Could not connect');
          return;
        }
        setAccount(json.data.account);
        setEndpoint(json.data.endpoint);
      } catch (err) {
        if (!silent) setError((err as Error).message);
      } finally {
        if (!silent) setConnecting(false);
      }
    },
    [username, password],
  );

  // Once connected, keep the transfer list current — the automated feed
  // delivers outside the browser.
  useEffect(() => {
    if (!account) return;
    timer.current = setInterval(() => void connect(true), 8000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [account, connect]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setArchitect(null);
    setAccount(null);
  }

  if (checking) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  if (!architect) {
    return (
      <main className="flex-1 overflow-y-auto p-8">
        <ArchitectSignIn
          onSignedIn={async (a) => {
            setArchitect(a);
            await loadSession();
          }}
        />
      </main>
    );
  }

  const ep = endpoint;

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">SFTP file transfer</h1>
            <p className="mt-1 text-sm text-slate-500">
              Send your AQI readings to CIDCO as a CSV, by hand or automatically.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-slate-900">{architect.email}</p>
            <button onClick={signOut} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>

        {/* Connect — exactly what an SFTP client asks for */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {account ? 'Connected' : 'Connect to CIDCO'}
            </h2>
            <p className="text-xs text-slate-500">
              Use the site name CIDCO registered (e.g. <span className="font-mono">test03</span>) as
              your user id, and password <span className="font-mono">123456</span> (same as the portal
              login).
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="cx-host" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Designated IP
              </label>
              <input
                id="cx-host"
                readOnly
                value={ep ? `${ep.designatedIp}:${ep.port}` : '…'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700"
              />
            </div>
            <div>
              <label htmlFor="cx-user" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                User id
              </label>
              <input
                id="cx-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="test03"
                autoComplete="off"
                className={`${INPUT} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="cx-pass" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Password
              </label>
              <input
                id="cx-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="from CIDCO’s email"
                autoComplete="off"
                className={INPUT}
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={connecting || !username || !password}
                className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {connecting ? 'Connecting…' : account ? 'Reconnect' : 'Connect'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}
        </form>

        {!account ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-900">Not connected yet</p>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
              CIDCO registers your company first — the site name and the path your
              CSV is exported to — then issues SFTP access using that site name as the user id.
              Enter the site name above with password <span className="font-mono">123456</span> to
              connect.
            </p>
          </div>
        ) : (
          <>
            {/* What CIDCO holds — and therefore what every transfer must match */}
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-violet-900">{account.company.siteName}</span>
                <span className="rounded bg-white/70 px-2 py-0.5 font-mono text-xs text-violet-800">
                  {account.company.siteName}
                </span>
                {!account.company.active && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">INACTIVE</span>
                )}
              </div>
              <p className="mt-2 text-sm text-violet-900">
                CIDCO validates every transfer against this registration. All three have to match or
                nothing is stored.
              </p>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-violet-700">File path</dt>
                  <dd className="mt-0.5 break-all font-mono text-sm text-violet-950">{account.company.designatedPath}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-violet-700">Send to</dt>
                  <dd className="mt-0.5 font-mono text-sm text-violet-950">
                    {ep?.designatedIp}:{ep?.port}
                  </dd>
                </div>
              </dl>
            </div>

            <FileTransferPanes
              username={account.username}
              password={password}
              designatedIp={ep?.designatedIp ?? ''}
              port={ep?.port ?? 0}
              registeredPath={account.company.designatedPath}
              delivered={account.uploads}
              onTransferred={() => connect(true)}
            />

            {/* The automated route */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">Sending automatically</h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    On your own server, point any SFTP client at the designated address with your user
                    id and password, and put the CSV from{' '}
                    <code className="font-mono">{account.company.designatedPath}</code> on a schedule:
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
{`sftp -P ${ep?.port} ${account.username}@${ep?.designatedIp}
sftp> put ${account.company.designatedPath}/readings.csv ${account.company.designatedPath}/`}
                  </pre>
                  <p className="mt-2 text-xs text-slate-500">
                    The repo ships a ready-made sender —{' '}
                    <code className="font-mono">npx tsx scripts/architect-sender.ts</code> — that reads
                    the newest CSV from that path and sends it on an interval.
                  </p>
                </div>
                <div className="flex flex-none flex-col gap-2">
                  <a
                    href="/api/architect/sftp/template"
                    className="rounded-lg bg-violet-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    CSV template
                  </a>
                  <a
                    href="/api/architect/sftp/template?format=xlsx"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Excel template
                  </a>
                  <a
                    href="/docs/sftp"
                    target="_blank"
                    rel="noreferrer"
                    className="text-center text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Full SFTP guide →
                  </a>
                </div>
              </div>
            </div>

            {/* Per-transfer validation, as CIDCO ran it */}
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Your transfers</h2>
              {account.uploads.length === 0 ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                  Nothing sent yet. Every transfer will show here with CIDCO’s validation result.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {account.uploads.map((u) => (
                    <div
                      key={u.id}
                      className={`rounded-xl border p-4 shadow-sm ${
                        u.validationPassed ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{u.fileName}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            u.validationPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {u.status}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {u.mode === 'PORTAL' ? 'portal' : 'sftp'}
                        </span>
                        <span className="ml-auto text-xs text-slate-400">{fmt(u.receivedAt)}</span>
                      </div>

                      <p className="mt-2 flex flex-wrap gap-3 text-[11px]">
                        <span className={u.siteNameMatch ? 'text-emerald-700' : 'text-red-700'}>
                          {u.siteNameMatch ? '✓' : '✕'} site name {u.presentedSiteName ?? '—'}
                        </span>
                        <span className={u.ipMatch ? 'text-emerald-700' : 'text-red-700'}>
                          {u.ipMatch ? '✓' : '✕'} from {u.presentedIp ?? '—'}
                        </span>
                        <span className={u.pathMatch ? 'text-emerald-700' : 'text-red-700'}>
                          {u.pathMatch ? '✓' : '✕'} path {u.presentedPath ?? '—'}
                        </span>
                      </p>

                      {u.validationPassed ? (
                        <p className="mt-1.5 text-xs text-slate-600">
                          <span className="font-semibold text-slate-900">{u.importedCount}</span> of {u.rowCount} rows
                          stored as readings{u.failedCount > 0 ? ` · ${u.failedCount} rejected` : ''}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs font-medium text-red-800">
                          CIDCO refused this transfer — {u.rejectionReason}. Nothing was stored.
                        </p>
                      )}

                      {u.errors && u.errors.length > 0 && (
                        <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                          {u.errors.map((e) => (
                            <li key={e.row}>
                              <span className="font-semibold">Row {e.row}</span> — {e.error}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {account.commLogs.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {account.commLogs.map((l) => (
                        <tr key={l.id}>
                          <td className="whitespace-nowrap px-4 py-2 text-slate-400">{fmt(l.createdAt)}</td>
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-700">{l.event}</td>
                          <td className="px-4 py-2 text-slate-600">{l.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
