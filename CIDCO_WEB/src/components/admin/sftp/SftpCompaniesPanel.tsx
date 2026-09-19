'use client';

import { useCallback, useEffect, useState } from 'react';
import CopyField, { StatusBadge } from '../CopyField';
import { readJson } from '@/lib/fetchJson';

type Credential = {
  id: string;
  username: string;
  status: string;
  credentialExpiresAt: string;
  uploadCount: number;
};

type Company = {
  id: string;
  companyId: string;
  companyName: string;
  architectServerIp: string;
  filePath: string;
  notes: string | null;
  active: boolean;
  contactEmail: string | null;
  createdAt: string;
  credentials: Credential[];
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

/**
 * Step one of the SFTP channel: CIDCO registers the company by hand. This
 * record is the reference every later transfer is validated against, so it is
 * created before any credentials exist.
 */
export default function SftpCompaniesPanel() {
  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuingFor, setIssuingFor] = useState<string | null>(null);
  const [portalLogin, setPortalLogin] = useState<{
    email: string;
    password?: string;
    signInAt: string;
  } | null>(null);

  const [form, setForm] = useState({
    companyName: '',
    companyId: '',
    architectServerIp: '',
    filePath: '',
    publicKey: '',
    privateKey: '',
    userId: '',
    architectEmail: '',
    notes: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/companies');
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.companies);
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

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setCredential(null);
    try {
      const res = await fetch('/api/admin/sftp/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          companyId: form.companyId,
          architectServerIp: form.architectServerIp,
          filePath: form.filePath || '',
          publicKey: form.publicKey || undefined,
          privateKey: form.privateKey || undefined,
          userId: form.userId || undefined,
          architectEmail: form.architectEmail || undefined,
          notes: form.notes || undefined,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not register the company');
      setNotice(json.data.message);
      setForm({
        companyName: '',
        companyId: '',
        architectServerIp: '',
        filePath: '',
        publicKey: '',
        privateKey: '',
        userId: '',
        architectEmail: '',
        notes: '',
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Step two: the credentials CIDCO emails, issued against this registration. */
  async function issueCredentials(companyId: string) {
    setIssuingFor(companyId);
    setError(null);
    setNotice(null);
    setCredential(null);
    try {
      const res = await fetch('/api/admin/sftp/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not issue credentials');
      setCredential(JSON.stringify(json.data.credential, null, 2));
      setPortalLogin(json.data.portalLogin ?? null);
      setNotice(json.data.message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIssuingFor(null);
    }
  }

  async function toggleActive(c: Company) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/sftp/companies/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not update');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Registered companies</h2>
        <p className="mt-1 text-sm text-slate-500">
          Register the company <strong>before</strong> issuing any credentials. What you enter here is
          the reference CIDCO checks every single transfer against — the company id quoted, the server
          address the data arrives from, and the file path it is taken from.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {portalLogin && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold">The architect signs in with the shared CIDCO portal login</p>
          <p className="mt-1">
            <span className="font-mono">{portalLogin.email}</span>
            {portalLogin.password ? (
              <>
                {' '}
                / <span className="font-mono">{portalLogin.password}</span>
              </>
            ) : null}{' '}
            at <span className="font-mono">{portalLogin.signInAt}</span>. They then connect with the
            company id as the SFTP user id; the password is the same as this portal login.
          </p>
        </div>
      )}

      {credential && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-medium text-emerald-900">
            Email this to the architect. The user id is the company id you registered. The password
            matches the shared portal login (
            <span className="font-mono">cidco@gmail.com</span> / <span className="font-mono">123456</span>
            ).
          </p>
          <CopyField label="SFTP credentials" value={credential} />
        </div>
      )}

      <form onSubmit={register} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Register a company</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="co-name" className="mb-1 block text-xs font-medium text-slate-600">Company name</label>
            <input id="co-name" required value={form.companyName} onChange={set('companyName')} className={INPUT} placeholder="Nair Design Studio" />
          </div>
          <div>
            <label htmlFor="co-id" className="mb-1 block text-xs font-medium text-slate-600">Company id</label>
            <input id="co-id" required value={form.companyId} onChange={set('companyId')} className={INPUT} placeholder="CIDCO-CO-0142" />
          </div>
          <div>
            <label htmlFor="co-ip" className="mb-1 block text-xs font-medium text-slate-600">
              Architect&rsquo;s server IP
            </label>
            <input id="co-ip" required value={form.architectServerIp} onChange={set('architectServerIp')} className={INPUT} placeholder="203.0.113.9" />
            <p className="mt-1 text-[11px] text-slate-400">Data is only accepted from this address.</p>
          </div>
          <div>
            <label htmlFor="co-path" className="mb-1 block text-xs font-medium text-slate-600">File path (optional)</label>
            <input id="co-path" value={form.filePath} onChange={set('filePath')} className={INPUT} placeholder="/var/aqi/exports" />
            <p className="mt-1 text-[11px] text-slate-400">
              Optional. When blank, poll1 still accepts the file and builds company/month/date/timestamp.
            </p>
          </div>
          <div>
            <label htmlFor="co-userid" className="mb-1 block text-xs font-medium text-slate-600">User ID (master)</label>
            <input id="co-userid" value={form.userId} onChange={set('userId')} className={INPUT} placeholder="cidco@example.com" />
          </div>
          <div>
            <label htmlFor="co-pub" className="mb-1 block text-xs font-medium text-slate-600">Public key (master)</label>
            <input id="co-pub" value={form.publicKey} onChange={set('publicKey')} className={INPUT} placeholder="optional" />
          </div>
          <div>
            <label htmlFor="co-priv" className="mb-1 block text-xs font-medium text-slate-600">Private key (master)</label>
            <input id="co-priv" value={form.privateKey} onChange={set('privateKey')} className={INPUT} placeholder="optional" />
          </div>
          <div>
            <label htmlFor="co-arch" className="mb-1 block text-xs font-medium text-slate-600">
              Architect account email
            </label>
            <input id="co-arch" type="email" value={form.architectEmail} onChange={set('architectEmail')} className={INPUT} placeholder="architect@example.com" />
            <p className="mt-1 text-[11px] text-slate-400">
              Stored as contact detail. Architects sign in with the shared CIDCO portal login.
            </p>
          </div>
          <div>
            <label htmlFor="co-notes" className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</label>
            <input id="co-notes" value={form.notes} onChange={set('notes')} className={INPUT} />
          </div>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-4 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {busy ? 'Registering…' : 'Register company'}
        </button>
      </form>

      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No companies registered yet. Register one above, then issue its SFTP credentials.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{c.companyName}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{c.companyId}</span>
                {!c.active && (
                  <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                    INACTIVE
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-400">registered {fmt(c.createdAt)}</span>
              </div>

              <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-slate-500">Architect server IP</dt>
                  <dd className="mt-1 font-mono text-sm text-slate-900">{c.architectServerIp}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-slate-500">File path</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-slate-900">{c.filePath}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-slate-500">Architect contact</dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {c.contactEmail ?? <span className="text-slate-400">—</span>}
                  </dd>
                </div>
              </dl>

              {c.notes && <p className="mt-3 text-xs text-slate-500">{c.notes}</p>}

              {c.credentials.length > 0 && (
                <div className="mt-4 space-y-1 border-t border-slate-100 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Credentials issued</p>
                  {c.credentials.map((cr) => (
                    <div key={cr.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="font-mono text-slate-800">{cr.username}</span>
                      <StatusBadge status={cr.status} />
                      <span>{cr.uploadCount} transfer{cr.uploadCount === 1 ? '' : 's'}</span>
                      <span className="text-slate-400">expires {fmt(cr.credentialExpiresAt)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => issueCredentials(c.companyId)}
                  disabled={issuingFor === c.companyId || !c.active}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                >
                  {issuingFor === c.companyId ? 'Issuing…' : 'Issue SFTP credentials'}
                </button>
                <button
                  onClick={() => toggleActive(c)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {c.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
