'use client';

import { useState } from 'react';
import { readJson } from '@/lib/fetchJson';

type AdminUser = { id: string; name: string; email: string; role: string };

export default function AdminSignIn({ onSignedIn }: { onSignedIn: (user: AdminUser) => void }) {
  const [email, setEmail] = useState('officer@cidco.example');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      onSignedIn(json.data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">CIDCO officer sign-in</h2>
      <p className="mt-1 text-sm text-slate-500">
        Managing architect integrations (issuing credentials, generating tokens, reviewing the
        exchange) requires a CIDCO officer session.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        <div>
          <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
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
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cidco-700 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-slate-400">Seeded officer: officer@cidco.example / Password123</p>
      </form>
    </div>
  );
}
