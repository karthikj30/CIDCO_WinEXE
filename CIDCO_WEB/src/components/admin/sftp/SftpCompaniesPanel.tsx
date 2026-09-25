'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import CopyField from '../CopyField';
import { readJson } from '@/lib/fetchJson';

/**
 * The MASTER table: the sites CIDCO holds details for.
 *
 * Registering is optional — poll1 creates a row from the name in the first
 * file that arrives — so this is as much a register of what has turned up as
 * a list of what was set up in advance.
 */

type Lookup = { id: string; name: string; active: boolean };

type Credential = {
  id: string;
  username: string;
  status: string;
  credentialExpiresAt: string;
  uploadCount: number;
};

type Company = {
  id: string;
  siteName: string;
  designatedPath: string;
  publicKey: string | null;
  privateKey: string | null;
  userId: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  architectName: string | null;
  department: { id: string; name: string } | null;
  node: { id: string; name: string } | null;
  notes: string | null;
  registeredLatitude: number | null;
  registeredLongitude: number | null;
  permittedRadiusMetres: number;
  active: boolean;
  createdAt: string;
  credentials: Credential[];
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

const EMPTY = {
  siteName: '',
  userId: '',
  publicKey: '',
  privateKey: '',
  designatedPath: '',
  mobile: '',
  email: '',
  address: '',
  architectName: '',
  departmentId: '',
  nodeId: '',
  notes: '',
  registeredLatitude: '',
  registeredLongitude: '',
  permittedRadiusMetres: '',
};

export default function SftpCompaniesPanel() {
  const [rows, setRows] = useState<Company[]>([]);
  const [nodes, setNodes] = useState<Lookup[]>([]);
  const [departments, setDepartments] = useState<Lookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuingFor, setIssuingFor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // null = the form is adding; an id = it is editing that row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  // --- filters -----------------------------------------------------------
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterNode, setFilterNode] = useState('');

  const load = useCallback(async () => {
    try {
      const [cRes, lRes] = await Promise.all([
        fetch('/api/admin/sftp/companies'),
        fetch('/api/admin/sftp/lookups'),
      ]);
      const cJson = await readJson(cRes);
      if (!cRes.ok) throw new Error(cJson.error ?? 'Failed to load');
      setRows(cJson.data.companies);
      if (lRes.ok) {
        const lJson = await readJson(lRes);
        setNodes(lJson.data.nodes);
        setDepartments(lJson.data.departments);
      }
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

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /** Adds a node or department without leaving the form. */
  async function addLookup(kind: 'node' | 'department') {
    const name = window.prompt(`New ${kind} name`)?.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/admin/sftp/lookups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, name }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? `Could not add the ${kind}`);
      const item: Lookup = json.data.item;
      if (kind === 'node') {
        setNodes((list) => (list.some((l) => l.id === item.id) ? list : [...list, item].sort((a, b) => a.name.localeCompare(b.name))));
        setForm((f) => ({ ...f, nodeId: item.id }));
      } else {
        setDepartments((list) => (list.some((l) => l.id === item.id) ? list : [...list, item].sort((a, b) => a.name.localeCompare(b.name))));
        setForm((f) => ({ ...f, departmentId: item.id }));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startAdd() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setShowForm(true);
  }

  function startEdit(c: Company) {
    setEditingId(c.id);
    setForm({
      siteName: c.siteName,
      userId: c.userId ?? '',
      // The API masks a stored private key, so the box starts empty and only
      // a value typed here replaces what is held.
      publicKey: c.publicKey ?? '',
      privateKey: '',
      designatedPath: c.designatedPath ?? '',
      mobile: c.mobile ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      architectName: c.architectName ?? '',
      departmentId: c.department?.id ?? '',
      nodeId: c.node?.id ?? '',
      notes: c.notes ?? '',
      registeredLatitude: c.registeredLatitude?.toString() ?? '',
      registeredLongitude: c.registeredLongitude?.toString() ?? '',
      permittedRadiusMetres: c.permittedRadiusMetres?.toString() ?? '',
    });
    setNotice(null);
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY });
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Editing sends every field so a cleared box really clears the value;
      // adding omits the empty ones so defaults apply.
      const payload = editingId
        ? {
            siteName: form.siteName,
            designatedPath: form.designatedPath,
            userId: form.userId,
            publicKey: form.publicKey,
            mobile: form.mobile,
            email: form.email,
            address: form.address,
            architectName: form.architectName,
            departmentId: form.departmentId,
            nodeId: form.nodeId,
            notes: form.notes,
            registeredLatitude: form.registeredLatitude === '' ? null : form.registeredLatitude,
            registeredLongitude: form.registeredLongitude === '' ? null : form.registeredLongitude,
            ...(form.permittedRadiusMetres ? { permittedRadiusMetres: form.permittedRadiusMetres } : {}),
            // Left blank means "keep the stored one", not "wipe it".
            ...(form.privateKey ? { privateKey: form.privateKey } : {}),
          }
        : {
            siteName: form.siteName,
            designatedPath: form.designatedPath,
            userId: form.userId || undefined,
            publicKey: form.publicKey || undefined,
            privateKey: form.privateKey || undefined,
            mobile: form.mobile || undefined,
            email: form.email || undefined,
            address: form.address || undefined,
            architectName: form.architectName || undefined,
            departmentId: form.departmentId || undefined,
            nodeId: form.nodeId || undefined,
            notes: form.notes || undefined,
            registeredLatitude: form.registeredLatitude || undefined,
            registeredLongitude: form.registeredLongitude || undefined,
            permittedRadiusMetres: form.permittedRadiusMetres || undefined,
          };
      const res = await fetch(
        editingId ? `/api/admin/sftp/companies/${editingId}` : '/api/admin/sftp/companies',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? (editingId ? 'Could not save' : 'Could not register'));
      setNotice(json.data.message ?? (editingId ? 'Company updated.' : 'Site registered.'));
      closeForm();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function issueCredentials(id: string) {
    const company = rows.find((c) => c.id === id);
    if (!company) return;
    setIssuingFor(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/sftp/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteName: company.siteName }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Could not issue credentials');
      const c = json.data.credentials;
      setCredential(
        `Site: ${c.siteName}\nUser id: ${c.username}\nPassword: ${c.password}\n` +
          `Address: ${c.designatedIp}:${c.port}\nPath: ${c.designatedPath ?? '—'}`,
      );
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

  // Search covers the three free-text things an officer would look up by;
  // node and department are lists, so they are their own controls.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (filterDept && c.department?.id !== filterDept) return false;
      if (filterNode && c.node?.id !== filterNode) return false;
      if (!q) return true;
      return [c.siteName, c.userId, c.architectName, c.email]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, search, filterDept, filterNode]);

  const filtering = Boolean(search.trim() || filterDept || filterNode);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Companies (master)</h2>
          <p className="mt-1 text-sm text-slate-500">
            The master table — every site CIDCO holds details for. A site does not have to be
            registered before data arrives: poll1 creates one from the file name. Registering adds
            everything else.
          </p>
        </div>
        <button
          onClick={() => (showForm ? closeForm() : startAdd())}
          className="rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cidco-700"
        >
          {showForm ? 'Close' : '+ Add company'}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      {credential && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-medium text-emerald-900">Email this to the architect.</p>
          <CopyField label="SFTP credentials" value={credential} />
        </div>
      )}

      {showForm && (
        <form onSubmit={register} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">
            {editingId ? `Edit ${form.siteName || 'company'}` : 'Add a company'}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="co-site" className={LABEL}>Site name</label>
              <input id="co-site" required value={form.siteName} onChange={set('siteName')} className={INPUT} placeholder="Kharghar Sector 12" />
              <p className="mt-1 text-[11px] text-slate-400">
                Identifies the site everywhere: the agent puts it in every file name and CIDCO files
                by it. Letters, digits, spaces, dot, dash and underscore.
              </p>
            </div>
            <div>
              <label htmlFor="co-user" className={LABEL}>User ID</label>
              <input id="co-user" value={form.userId} onChange={set('userId')} className={INPUT} placeholder="cidco@example.com" />
            </div>

            <div>
              <label htmlFor="co-path" className={LABEL}>Designated path</label>
              <input id="co-path" value={form.designatedPath} onChange={set('designatedPath')} className={INPUT} placeholder="/home/ubuntu/cidco/sftp1" />
              <p className="mt-1 text-[11px] text-slate-400">Where this site&rsquo;s agent delivers to.</p>
            </div>
            <div>
              <label htmlFor="co-arch" className={LABEL}>Architect name</label>
              <input id="co-arch" value={form.architectName} onChange={set('architectName')} className={INPUT} placeholder="R. K. Nair" />
            </div>

            <div>
              <label htmlFor="co-dept" className={LABEL}>Department</label>
              <div className="flex gap-2">
                <select id="co-dept" value={form.departmentId} onChange={set('departmentId')} className={INPUT}>
                  <option value="">— none —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => addLookup('department')} className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  + New
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="co-node" className={LABEL}>Node</label>
              <div className="flex gap-2">
                <select id="co-node" value={form.nodeId} onChange={set('nodeId')} className={INPUT}>
                  <option value="">— none —</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => addLookup('node')} className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  + New
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="co-mobile" className={LABEL}>Mobile number</label>
              <input id="co-mobile" value={form.mobile} onChange={set('mobile')} className={INPUT} placeholder="+91 98200 00000" />
            </div>
            <div>
              <label htmlFor="co-email" className={LABEL}>Email</label>
              <input id="co-email" type="email" value={form.email} onChange={set('email')} className={INPUT} placeholder="architect@example.com" />
            </div>

            <div>
              <label htmlFor="co-pub" className={LABEL}>Public key</label>
              <input id="co-pub" value={form.publicKey} onChange={set('publicKey')} className={INPUT} placeholder="optional" />
            </div>
            <div>
              <label htmlFor="co-priv" className={LABEL}>Private key</label>
              <input
                id="co-priv"
                value={form.privateKey}
                onChange={set('privateKey')}
                className={INPUT}
                placeholder={editingId ? 'leave blank to keep the stored key' : 'optional'}
              />
            </div>

            <div className="sm:col-span-2">
              <p className={LABEL}>Registered position</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  aria-label="Registered latitude"
                  value={form.registeredLatitude}
                  onChange={set('registeredLatitude')}
                  className={INPUT}
                  placeholder="latitude, e.g. 19.033000"
                />
                <input
                  aria-label="Registered longitude"
                  value={form.registeredLongitude}
                  onChange={set('registeredLongitude')}
                  className={INPUT}
                  placeholder="longitude, e.g. 73.029700"
                />
                <input
                  aria-label="Permitted radius in metres"
                  value={form.permittedRadiusMetres}
                  onChange={set('permittedRadiusMetres')}
                  className={INPUT}
                  placeholder="radius in metres (500)"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Where CIDCO says the site is. The agent reports where each file was actually sent
                from, and the monitoring map measures the distance between the two — a delivery
                further out than this radius is flagged.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="co-addr" className={LABEL}>Address</label>
              <input id="co-addr" value={form.address} onChange={set('address')} className={INPUT} placeholder="Plot 12, Sector 4, Kharghar, Navi Mumbai" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="co-notes" className={LABEL}>Notes (optional)</label>
              <input id="co-notes" value={form.notes} onChange={set('notes')} className={INPUT} />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-4 rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cidco-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Register company'}
          </button>
        </form>
      )}

      {/* --- filters --- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search site, user id, architect or email…"
          className="min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select value={filterNode} onChange={(e) => setFilterNode(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">All nodes</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        {filtering && (
          <button
            onClick={() => {
              setSearch('');
              setFilterDept('');
              setFilterNode('');
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-slate-500">
          {filtering ? `${shown.length} of ${rows.length}` : `${rows.length}`} compan
          {(filtering ? shown.length : rows.length) === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          {rows.length === 0
            ? 'No companies yet. Add one above, or let one appear on its own the first time an architect delivers a file.'
            : 'Nothing matches those filters.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-max min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Site name</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">User id</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Department</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Node</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Designated path</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Mobile</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Public key</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Private key</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                {/* Pinned so the actions stay reachable however far the table
                    is scrolled. */}
                <th className="sticky right-0 border-l border-slate-200 bg-slate-50 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((c) => (
                <tr key={c.id} className={c.active ? undefined : 'bg-slate-50/70 text-slate-400'}>
                  {/* Each cell carries the detail that belongs with it on a
                      second line — thirteen separate columns did not fit on
                      one screen, and the officer reads them in pairs anyway. */}
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-900">{c.siteName}</div>
                    <div className="text-xs text-slate-500">{c.architectName || <Dash />}</div>
                  </td>
                  {/* A cuid is 25 characters of no interest until you need
                      the whole thing, so it is truncated with the full value
                      on hover — it was pushing the key columns off screen. */}
                  <td className="max-w-[150px] px-3 py-2">
                    <div className="truncate font-mono text-xs text-slate-700" title={c.userId ?? ''}>
                      {c.userId || <Dash />}
                    </div>
                    <div className="truncate text-xs text-slate-500" title={c.email ?? ''}>
                      {c.email || <Dash />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.department?.name || <Dash />}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.node?.name || <Dash />}</td>
                  <td className="max-w-[180px] px-3 py-2">
                    <div className="truncate font-mono text-xs text-slate-600" title={c.designatedPath}>
                      {c.designatedPath || <Dash />}
                    </div>
                    <div className="truncate text-xs text-slate-500" title={c.address ?? ''}>
                      {c.address || <Dash />}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{c.mobile || <Dash />}</td>
                  <td className="max-w-[150px] px-3 py-2">
                    <div className="truncate font-mono text-xs text-slate-600" title={c.publicKey ?? ''}>
                      {c.publicKey || <Dash />}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {/*
                      The API masks it, so what arrives here is bullets, never
                      the key. Showing whether one is held is the useful part;
                      handing a stored private key to a browser is not.
                    */}
                    {c.privateKey ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                        stored
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        c.active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {c.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    <div className="mt-0.5 text-xs text-slate-500">{fmt(c.createdAt)}</div>
                  </td>
                  <td
                    className={`sticky right-0 whitespace-nowrap border-l border-slate-200 px-3 py-2 text-right ${
                      c.active ? 'bg-white' : 'bg-slate-50'
                    }`}
                  >
                    <button
                      onClick={() => startEdit(c)}
                      className="mr-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => issueCredentials(c.id)}
                      disabled={issuingFor === c.id}
                      className="mr-2 rounded-md border border-cidco-200 bg-cidco-50 px-2 py-1 text-xs font-semibold text-cidco-700 hover:bg-cidco-100 disabled:opacity-50"
                    >
                      {issuingFor === c.id ? 'Issuing\u2026' : 'Credentials'}
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
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-slate-400">—</span>;
}
