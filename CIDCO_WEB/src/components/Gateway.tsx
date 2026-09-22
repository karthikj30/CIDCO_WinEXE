'use client';

import { useCallback, useEffect, useState } from 'react';
import { readJson } from '@/lib/fetchJson';

/**
 * The single front door to the portal.
 *
 * Everyone signs in (or signs up) here, and only then picks the channel they
 * work in — API or SFTP. Each choice opens its own dashboard; the two never
 * share a screen.
 */
type Role = 'CIDCO_OFFICER' | 'ARCHITECT';
type Mode = 'signin' | 'signup';
type User = { id: string; name: string; email: string; role: string; firmName?: string | null };

const INPUT =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500';

const CHANNELS = [
  {
    key: 'API',
    name: 'API integration',
    blurb: 'Token-authenticated REST. The architect’s station posts readings to CIDCO every few hours.',
    detail: 'Access + refresh tokens · automated sending · live reading feed',
    officerHref: '/cidco',
    architectHref: '/architect',
    accent: 'cidco',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    key: 'SFTP',
    name: 'SFTP file transfer',
    blurb: 'The architect sends a CSV of readings over SFTP, automatically. CIDCO validates every transfer and imports it.',
    detail: 'User id + password · CSV over SFTP · per-transfer validation',
    officerHref: '/cidco/sftp',
    architectHref: '/architect/sftp',
    accent: 'violet',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M12 18v-6" />
        <polyline points="9 15 12 12 15 15" />
      </svg>
    ),
  },
] as const;

export default function Gateway() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState<Role>('CIDCO_OFFICER');
  const [mode, setMode] = useState<Mode>('signin');
  const [form, setForm] = useState({ email: '', password: '', name: '', firmName: '', councilRegNo: '', phone: '', signupCode: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Resume whichever session this browser already holds for the chosen role.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return setUser(null);
      const json = await readJson(res);
      setUser(json?.success ? json.data.user : null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setChecking(false);
    })();
  }, [refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Signing up as an officer goes to its own endpoint. /api/auth/register
      // makes architects and nothing else — it ignored the role it was sent,
      // so picking "CIDCO officer" here quietly produced an architect account
      // and dropped the new officer on the architect dashboard.
      const officerSignup = mode === 'signup' && role === 'CIDCO_OFFICER';
      const path = mode === 'signin'
        ? '/api/auth/login'
        : officerSignup
          ? '/api/auth/officer-signup'
          : '/api/auth/register';
      const body =
        mode === 'signin'
          ? { email: form.email, password: form.password }
          : officerSignup
            ? {
                email: form.email,
                password: form.password,
                name: form.name,
                signupCode: form.signupCode || undefined,
              }
            : {
                email: form.email,
                password: form.password,
                name: form.name,
                firmName: form.firmName || undefined,
                councilRegNo: form.councilRegNo || undefined,
                phone: form.phone || undefined,
              };
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not sign you in');
      setUser(json.data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setForm({ email: '', password: '', name: '', firmName: '', councilRegNo: '', phone: '', signupCode: '' });
  }

  if (checking) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  // --- Signed in: choose the channel ---------------------------------------
  if (user) {
    const isOfficer = user.role !== 'ARCHITECT';
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {isOfficer ? 'CIDCO officer' : 'Architect'}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Welcome, {user.name}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Choose how {isOfficer ? 'you want to work with architect data' : 'you want to send your AQI data'}. Each
              channel has its own dashboard.
            </p>
          </div>
          <button onClick={signOut} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Sign out
          </button>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {CHANNELS.map((c) => {
            const href = isOfficer ? c.officerHref : c.architectHref;
            const violet = c.accent === 'violet';
            return (
              <a
                key={c.key}
                href={href}
                className={`group flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                  violet ? 'border-violet-200 hover:border-violet-400' : 'border-cidco-200 hover:border-cidco-400'
                }`}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                    violet ? 'bg-violet-50 text-violet-700' : 'bg-cidco-50 text-cidco-700'
                  }`}
                >
                  {c.icon}
                </div>
                <h2 className="mt-4 text-lg font-bold text-slate-900">{c.name}</h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-600">{c.blurb}</p>
                <p className="mt-3 text-xs text-slate-400">{c.detail}</p>
                <span
                  className={`mt-4 inline-flex items-center gap-1 text-sm font-semibold ${
                    violet ? 'text-violet-700' : 'text-cidco-700'
                  }`}
                >
                  Open {c.key} dashboard
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </a>
            );
          })}
        </div>

        <p className="mt-8 text-xs text-slate-400">
          Signed in as {user.email}. Officers and architects can be signed in side by side in the same browser.
        </p>
      </div>
    );
  }

  // --- Signed out: sign in or sign up --------------------------------------
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-14 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">CIDCO AQI Compliance Portal</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Architects submit Air Quality Index readings to CIDCO through one of two channels. Sign in and pick the one
          you use — the portal keeps them entirely separate.
        </p>
        <div className="mt-6 space-y-4">
          {CHANNELS.map((c) => (
            <div key={c.key} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4">
              <div
                className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${
                  c.accent === 'violet' ? 'bg-violet-50 text-violet-700' : 'bg-cidco-50 text-cidco-700'
                }`}
              >
                {c.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{c.blurb}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4">
          <a href="/docs/architect" className="text-xs font-medium text-cidco-700 hover:underline">
            → API channel documentation
          </a>
          <a href="/docs/sftp" className="text-xs font-medium text-violet-700 hover:underline">
            → SFTP channel documentation
          </a>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Which kind of account to create. Signing in does not need this —
            the account itself decides which dashboards you get. */}
        {mode === 'signup' && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            {(['CIDCO_OFFICER', 'ARCHITECT'] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  role === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {r === 'CIDCO_OFFICER' ? 'CIDCO officer' : 'Architect'}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-4 border-b border-slate-200">
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${
                mode === m ? 'border-cidco-600 text-cidco-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {m === 'signin' ? 'Sign in' : 'Create an account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

          {mode === 'signup' && (
            <div>
              <label htmlFor="g-name" className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
              <input id="g-name" required value={form.name} onChange={set('name')} className={INPUT} />
            </div>
          )}

          <div>
            <label htmlFor="g-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input id="g-email" type="email" required value={form.email} onChange={set('email')} className={INPUT} />
          </div>

          <div>
            <label htmlFor="g-password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
            <input
              id="g-password"
              type="password"
              required
              minLength={mode === 'signup' ? 8 : 1}
              value={form.password}
              onChange={set('password')}
              className={INPUT}
            />
          </div>

          {mode === 'signup' && role === 'CIDCO_OFFICER' && (
            <div>
              <label htmlFor="g-code" className="mb-1 block text-sm font-medium text-slate-700">
                CIDCO sign-up code
              </label>
              <input id="g-code" value={form.signupCode} onChange={set('signupCode')} className={INPUT} />
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                An officer reads every company&rsquo;s data, so this is not an open form. Leave it blank
                only when you are the very first officer on a fresh portal; after that CIDCO issues the
                code.
              </p>
            </div>
          )}

          {mode === 'signup' && role === 'ARCHITECT' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="g-firm" className="mb-1 block text-sm font-medium text-slate-700">Firm</label>
                <input id="g-firm" value={form.firmName} onChange={set('firmName')} className={INPUT} />
              </div>
              <div>
                <label htmlFor="g-coa" className="mb-1 block text-sm font-medium text-slate-700">COA reg. no.</label>
                <input id="g-coa" value={form.councilRegNo} onChange={set('councilRegNo')} className={INPUT} />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-cidco-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cidco-700 disabled:opacity-50"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <p className="text-xs leading-relaxed text-slate-400">
            {mode === 'signin'
              ? 'Use the email and password for your account — CIDCO officers, and architects using the login CIDCO created for them. After signing in you choose API or SFTP, and that dashboard opens.'
              : role === 'ARCHITECT'
                ? 'Architects whom CIDCO has already emailed credentials should sign in on the channel dashboard instead — the credentials set up the account.'
                : 'CIDCO officers manage both channels from their dashboards.'}
          </p>
        </form>
      </div>
    </div>
  );
}
