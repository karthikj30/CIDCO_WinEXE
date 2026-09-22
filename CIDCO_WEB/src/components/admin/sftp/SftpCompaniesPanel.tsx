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
  /** Master-table credentials. privateKey arrives masked from the API. */
  publicKey: string | null;
  privateKey: string | null;
  userId: string | null;
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
  // The register form used to sit permanently above the list, pushing the
  // companies themselves below the fold. It is the occasional action; the
  // table is what the page is for.
  const [showForm, setShowForm] = useState(false);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Companies (master)</h2>
          <p className="mt-1 text-sm text-slate-500">
            The master table — the company id an architect quotes, and the credentials CIDCO holds
            against it. A company does not have to be registered before data arrives: poll1 creates
            one from the file name. Registering adds the details below.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cidco-700"
        >
          {showForm ? 'Close' : '+ Add company'}
        </button>
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

      {showForm && (
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
              Architect&rsquo;s server IP (optional)
            </label>
            <input id="co-ip" value={form.architectServerIp} onChange={set('architectServerIp')} className={INPUT} placeholder="203.0.113.9 (optional)" />
            <p className="mt-1 text-[11px] text-slate-400">
              Recorded on the company, for reference. It does not gate transfers: a file is filed by
              the company and time in its name, whatever address it arrives from.
            </p>
          </div>
          <div>
            <label htmlFor="co-path" className="mb-1 block text-xs font-medium text-slate-600">File path (optional)</label>
            <input id="co-path" value={form.filePath} onChange={set('filePath')} className={INPUT} placeholder="/var/aqi/exports" />
            <p className="mt-1 text-[11px] text-slate-400">
              Optional, and not checked. poll1 files every accepted CSV as
              companyId/dd_mm_yyyy/hh-mm-ss.csv regardless of what is here.
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
      )}

      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No companies yet. Add one above, or let one appear on its own the first time an architect
          delivers a file.
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {rows.length} compan{rows.length === 1 ? 'y' : 'ies'} · the{' '}
            <code className="rounded bg-slate-100 px-1">companies</code> table
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Company id</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Name</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">User id</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Public key</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Private key</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Server IP</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">File path</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Contact</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Registered</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Credentials</th>
                  {/* Pinned: with twelve columns the actions scroll out of
                      reach, and nothing on screen says they are there. */}
                  <th className="sticky right-0 border-l border-slate-200 bg-slate-50 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className={c.active ? undefined : 'bg-slate-50/70 text-slate-400'}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-slate-900">
                      {c.companyId}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-800">{c.companyName}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">
                      {c.userId || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600" title={c.publicKey ?? ''}>
                      {c.publicKey ? `${c.publicKey.slice(0, 18)}…` : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {/* The API masks it before it leaves the server; a stored
                          private key is never sent to a browser. */}
                      {c.privateKey ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">stored</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                      {c.architectServerIp || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {c.filePath || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                      {c.contactEmail || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          c.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {c.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmt(c.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                      {c.credentials.length === 0 ? (
                        <span className="text-slate-400">none</span>
                      ) : (
                        <span title={c.credentials.map((cr) => `${cr.username} (${cr.status})`).join(', ')}>
                          {c.credentials.length} issued ·{' '}
                          {c.credentials.reduce((n, cr) => n + cr.uploadCount, 0)} uploads
                        </span>
                      )}
                    </td>
                    <td
                      className={`sticky right-0 whitespace-nowrap border-l border-slate-200 px-3 py-2 text-right ${
                        c.active ? 'bg-white' : 'bg-slate-50'
                      }`}
                    >
                      <button
                        onClick={() => issueCredentials(c.id)}
                        disabled={issuingFor === c.id}
                        className="mr-2 rounded-md border border-cidco-200 bg-cidco-50 px-2 py-1 text-xs font-semibold text-cidco-700 hover:bg-cidco-100 disabled:opacity-50"
                      >
                        {issuingFor === c.id ? 'Issuing…' : 'Issue SFTP credentials'}
                      </button>
                      <button
                        onClick={() => toggleActive(c)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {c.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
