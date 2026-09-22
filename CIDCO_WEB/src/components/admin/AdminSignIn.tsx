'use client';

import { useState } from 'react';
import { readJson } from '@/lib/fetchJson';

type AdminUser = { id: string; name: string; email: string; role: string };

export default function AdminSignIn({ onSignedIn }: { onSignedIn: (user: AdminUser) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Whether the session actually survived.
   *
   * The password being right and being signed in are different things: the
   * session lives in a cookie, and a browser silently refuses to store a
   * Secure cookie on an http:// page. Without this the portal reported
   * success and then answered "sign-in required" on every panel.
   */
  async function confirmSession() {
    const check = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!check.ok) {
      throw new Error(
        'Your password was accepted, but the browser did not keep the session cookie, so the ' +
          'portal still sees you as signed out. This happens when the site is served over ' +
          'http:// while the server marks the cookie Secure. Serve the portal over https, or ' +
          'set COOKIE_SECURE=false in CIDCO_WEB/.env and restart it.',
      );
    }
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/officer-signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, signupCode }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not create the account');
      await confirmSession();
      onSignedIn(json.data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Sign in failed');
      if (json.data.user.role === 'ARCHITECT') {
        throw new Error('This account is an architect. Sign in as a CIDCO officer.');
      }

      // The password was right, but that is not the same as being signed in.
      // The session lives in a cookie, and a browser silently refuses to store
      // a Secure cookie on an http:// page — so this used to report success
      // and then every panel answered "CIDCO officer sign-in required", with
      // the officer's own name in the sidebar. Ask the server who we are
      // before saying it worked.
      await confirmSession();
      onSignedIn(json.data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const signingUp = mode === 'signup';
  const FIELD =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500';

  return (
    <div className="max-w-md">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">
        {signingUp ? 'Create a CIDCO officer account' : 'CIDCO officer sign-in'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {signingUp
          ? 'Officers see every company\u2019s data and every delivered transfer.'
          : 'Managing architect integrations \u2014 issuing credentials, generating tokens, reviewing the exchange \u2014 requires a CIDCO officer session.'}
      </p>

      <div className="mt-4 inline-flex overflow-hidden rounded-lg border border-slate-300">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`px-4 py-1.5 text-sm font-semibold ${
              mode === m ? 'bg-cidco-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {m === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        ))}
      </div>

      <form
        onSubmit={signingUp ? signUp : submit}
        className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        {signingUp && (
          <div>
            <label htmlFor="admin-name" className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
            <input id="admin-name" value={name} onChange={(e) => setName(e.target.value)} required className={FIELD} />
          </div>
        )}

        <div>
          <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 8 : undefined}
            className={FIELD}
          />
          {signingUp && <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>}
        </div>

        {signingUp && (
          <div>
            <label htmlFor="admin-code" className="mb-1 block text-sm font-medium text-slate-700">
              Sign-up code
            </label>
            <input
              id="admin-code"
              value={signupCode}
              onChange={(e) => setSignupCode(e.target.value)}
              className={FIELD}
              placeholder="from CIDCO"
            />
            <p className="mt-1 text-xs text-slate-400">
              Issued by CIDCO. Not needed for the very first officer account, when there is nobody
              who could hand one out.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cidco-700 disabled:opacity-50"
        >
          {loading
            ? signingUp
              ? 'Creating\u2026'
              : 'Signing in\u2026'
            : signingUp
              ? 'Create officer account'
              : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
