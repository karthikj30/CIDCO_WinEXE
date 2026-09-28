'use client';

import { useState } from 'react';
import { readJson } from '@/lib/fetchJson';

export type Architect = { id: string; name: string; email: string; role: string };

export default function ArchitectSignIn({ onSignedIn }: { onSignedIn: (a: Architect) => void }) {
  const [email, setEmail] = useState('architect@example.com');
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
      if (json.data.user.role !== 'ARCHITECT') {
        throw new Error('That account is a CIDCO officer. Use the CIDCO admin portal at /.');
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
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">Architect sign-in</h2>
      <p className="mt-1 text-sm text-slate-500">
        Sign in with your architect account to validate with CIDCO, manage your tokens and send AQI
        data.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        <div>
          <label htmlFor="arch-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            id="arch-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label htmlFor="arch-password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            id="arch-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-slate-400">Seeded architect: architect@example.com / Password123</p>
      </form>
    </div>
  );
}
