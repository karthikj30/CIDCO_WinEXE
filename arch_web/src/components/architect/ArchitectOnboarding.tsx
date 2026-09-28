'use client';

import { useCallback, useEffect, useState } from 'react';
import ArchitectSignIn, { type Architect } from './ArchitectSignIn';
import { readJson } from '@/lib/fetchJson';

/**
 * What an architect who has no portal account yet sees.
 *
 * 1. They enter the user id and password CIDCO emailed them.
 * 2. CIDCO reviews the request on its dashboard; this page waits.
 * 3. Once approved, they create their own username and password and fill in
 *    their details — which is what CIDCO then sees against them.
 */
type Step = 'credentials' | 'awaiting' | 'setup' | 'signin';

type StatusData = {
  clientId: string;
  status: string;
  approved: boolean;
  needsAccountSetup: boolean;
  accountEmail: string | null;
  latestRequest: {
    status: string;
    presentedIp: string | null;
    deviceInfo: string | null;
    reviewNote: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
};

const INPUT =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default function ArchitectOnboarding({ onSignedIn }: { onSignedIn: (a: Architect) => void }) {
  const [step, setStep] = useState<Step>('credentials');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The details the architect fills in for CIDCO once they are approved.
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirm: '',
    name: '',
    firmName: '',
    councilRegNo: '',
    phone: '',
    designation: '',
    address: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /** Asks CIDCO where this credential stands and routes to the right step. */
  const checkStatus = useCallback(
    async (id: string, secret: string) => {
      const res = await fetch('/api/architect/handshake-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: id, clientSecret: secret }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not check your status');
      const data = json.data as StatusData;
      setStatus(data);
      if (data.approved && data.needsAccountSetup) setStep('setup');
      else if (data.approved) setStep('signin');
      else setStep('awaiting');
      return data;
    },
    [],
  );

  // While the request sits with CIDCO, poll so approval lands without a reload.
  useEffect(() => {
    if (step !== 'awaiting' || !clientId || !clientSecret) return;
    const timer = setInterval(() => {
      checkStatus(clientId, clientSecret).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [step, clientId, clientSecret, checkStatus]);

  /** Step 1 — present the CIDCO-issued credentials for approval. */
  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Already approved? Go straight to account setup instead of re-queuing.
      const current = await checkStatus(clientId, clientSecret);
      if (current.approved) return;

      const res = await fetch('/api/architect/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          deviceInfo: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Validation failed');
      setNotice(json.data.message);
      setStep('awaiting');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Step 3 — the architect creates their own login and fills in their details. */
  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/architect/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          email: form.email,
          password: form.password,
          name: form.name,
          firmName: form.firmName || undefined,
          councilRegNo: form.councilRegNo || undefined,
          phone: form.phone || undefined,
          designation: form.designation || undefined,
          address: form.address || undefined,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not set up your account');
      onSignedIn({ ...json.data.user, role: 'ARCHITECT' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'signin') {
    return (
      <div className="max-w-md space-y-4">
        {status?.accountEmail && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            This credential is already set up as <strong>{status.accountEmail}</strong>. Sign in with the
            username and password you chose.
          </div>
        )}
        <ArchitectSignIn onSignedIn={onSignedIn} />
        <button
          onClick={() => setStep('credentials')}
          className="text-sm font-semibold text-emerald-700 hover:underline"
        >
          ← Start again with CIDCO credentials
        </button>
      </div>
    );
  }

  const banner = error && (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
  );

  if (step === 'awaiting') {
    const rejected = status?.latestRequest?.status === 'REJECTED';
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {rejected ? 'CIDCO did not approve this request' : 'Waiting for CIDCO to approve you'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {rejected
              ? 'You can correct the details with CIDCO and submit again.'
              : 'A CIDCO officer is checking your identity, IP address and device. This page updates on its own.'}
          </p>
        </div>
        {banner}
        {notice && !rejected && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {notice}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">CIDCO user id</dt>
              <dd className="font-mono text-slate-900">{status?.clientId ?? clientId}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
              <dd className="font-medium text-slate-900">{status?.status ?? 'AWAITING_APPROVAL'}</dd>
            </div>
            {status?.latestRequest?.presentedIp && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">IP registered</dt>
                <dd className="font-mono text-slate-900">{status.latestRequest.presentedIp}</dd>
              </div>
            )}
            {status?.latestRequest?.reviewNote && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">CIDCO note</dt>
                <dd className="text-slate-900">{status.latestRequest.reviewNote}</dd>
              </div>
            )}
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => {
                setBusy(true);
                checkStatus(clientId, clientSecret)
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Check now'}
            </button>
            <button
              onClick={() => setStep('credentials')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Use different credentials
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Create your login</h2>
          <p className="mt-1 text-sm text-slate-500">
            CIDCO has approved you. Choose the username and password you will use from now on, and fill
            in your details — CIDCO sees these against your integration.
          </p>
        </div>
        {banner}

        <form onSubmit={submitSetup} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="su-email" label="Username (email)">
              <input id="su-email" type="email" required value={form.email} onChange={set('email')} className={INPUT} />
            </Field>
            <Field id="su-name" label="Full name">
              <input id="su-name" required value={form.name} onChange={set('name')} className={INPUT} />
            </Field>
            <Field id="su-password" label="Password" hint="At least 8 characters.">
              <input id="su-password" type="password" required minLength={8} value={form.password} onChange={set('password')} className={INPUT} />
            </Field>
            <Field id="su-confirm" label="Confirm password">
              <input id="su-confirm" type="password" required minLength={8} value={form.confirm} onChange={set('confirm')} className={INPUT} />
            </Field>
            <Field id="su-firm" label="Firm / organisation">
              <input id="su-firm" value={form.firmName} onChange={set('firmName')} className={INPUT} />
            </Field>
            <Field id="su-coa" label="Council of Architecture reg. no.">
              <input id="su-coa" value={form.councilRegNo} onChange={set('councilRegNo')} className={INPUT} />
            </Field>
            <Field id="su-phone" label="Phone">
              <input id="su-phone" value={form.phone} onChange={set('phone')} className={INPUT} />
            </Field>
            <Field id="su-designation" label="Designation">
              <input id="su-designation" value={form.designation} onChange={set('designation')} className={INPUT} />
            </Field>
          </div>
          <Field id="su-address" label="Office address">
            <textarea id="su-address" rows={2} value={form.address} onChange={set('address')} className={INPUT} />
          </Field>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'Creating your account…' : 'Create account and open my dashboard'}
          </button>
        </form>
      </div>
    );
  }

  // step === 'credentials'
  return (
    <div className="max-w-md space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Connect with CIDCO</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enter the user id and password CIDCO emailed you. CIDCO will review the request and, once
          approved, you will create your own login here.
        </p>
      </div>
      {banner}

      <form onSubmit={submitCredentials} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Field id="cid" label="CIDCO user id">
          <input id="cid" required value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT} />
        </Field>
        <Field id="csecret" label="CIDCO password">
          <input
            id="csecret"
            type="password"
            required
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            className={INPUT}
          />
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Sending to CIDCO…' : 'Send for CIDCO approval'}
        </button>
      </form>

      <button onClick={() => setStep('signin')} className="text-sm font-semibold text-emerald-700 hover:underline">
        Already have an account? Sign in →
      </button>
    </div>
  );
}
