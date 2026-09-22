'use client';

import { useCallback, useRef, useState } from 'react';
import { readJson } from '@/lib/fetchJson';

/**
 * The WinSCP-style half of the architect's SFTP workspace.
 *
 * Left pane: their own machine — a folder they open, with its files listed.
 * Right pane: CIDCO, at the file path registered for their company.
 * Dragging a file from left to right (or dropping one straight in) sends it.
 *
 * Sending goes through the portal, which runs the file through exactly the same
 * validation and intake as a direct SFTP upload: the site name and the file
 * path are checked against the company registration before a single reading
 * is stored.
 */
type Delivered = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  rowCount: number;
  importedCount: number;
  failedCount: number;
  validationPassed: boolean;
  rejectionReason: string | null;
  receivedAt: string;
};

type LocalEntry = {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  handle?: FileSystemFileHandle;
  dirHandle?: FileSystemDirectoryHandle;
  file?: File;
};

type Props = {
  username: string;
  /** Held by the workspace from the connect form above. */
  password: string;
  designatedIp: string;
  port: number;
  registeredPath: string;
  delivered: Delivered[];
  onTransferred: () => Promise<void> | void;
};

const fmtTime = (d: string) => new Date(d).toLocaleString('en-IN');
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const isSendable = (name: string) => /\.(csv|xlsx)$/i.test(name);

// The directory picker is Chromium-only; everything else falls back to an
// ordinary folder input, which every browser supports.
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
};

export default function FileTransferPanes({
  username,
  password,
  designatedIp,
  port,
  registeredPath,
  delivered,
  onTransferred,
}: Props) {
  const [sourcePath, setSourcePath] = useState(registeredPath);
  const [localName, setLocalName] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [trail, setTrail] = useState<FileSystemDirectoryHandle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [log, setLog] = useState<Array<{ at: string; ok: boolean; text: string }>>([]);
  const folderInput = useRef<HTMLInputElement>(null);

  const note = (ok: boolean, text: string) =>
    setLog((l) => [{ at: new Date().toLocaleTimeString('en-IN'), ok, text }, ...l].slice(0, 12));

  /** Reads a directory handle into the left pane. */
  const readDir = useCallback(async (dir: FileSystemDirectoryHandle, path: FileSystemDirectoryHandle[]) => {
    const found: LocalEntry[] = [];
    // @ts-expect-error - values() is part of the File System Access API
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        found.push({ name: entry.name, kind: 'directory', size: 0, dirHandle: entry as FileSystemDirectoryHandle });
      } else {
        const handle = entry as FileSystemFileHandle;
        const file = await handle.getFile();
        found.push({ name: entry.name, kind: 'file', size: file.size, handle, file });
      }
    }
    found.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
    setEntries(found);
    setTrail(path);
    setLocalName(path.map((d) => d.name).join('/') || dir.name);
  }, []);

  async function openFolder() {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      folderInput.current?.click();
      return;
    }
    try {
      const dir = await picker.call(window, { mode: 'read' });
      await readDir(dir, [dir]);
    } catch {
      // The picker was dismissed — nothing to do.
    }
  }

  /** Fallback for browsers without the directory picker. */
  function onFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const root = files[0].webkitRelativePath?.split('/')[0] ?? 'Selected folder';
    setLocalName(root);
    setTrail([]);
    setEntries(
      files
        .map((f) => ({ name: f.webkitRelativePath || f.name, kind: 'file' as const, size: f.size, file: f }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async function enterDir(entry: LocalEntry) {
    if (!entry.dirHandle) return;
    await readDir(entry.dirHandle, [...trail, entry.dirHandle]);
  }

  async function goUp() {
    if (trail.length < 2) return;
    const path = trail.slice(0, -1);
    await readDir(path[path.length - 1], path);
  }

  /** The actual transfer: one file, validated by CIDCO before anything is kept. */
  const sending = useRef(false);
  const send = useCallback(
    async (file: File) => {
      // A second click (or a drop landing on top of one) must not resend.
      if (sending.current) return;
      if (!isSendable(file.name)) {
        note(false, `${file.name} is not a .csv or .xlsx file.`);
        return;
      }
      sending.current = true;
      setBusy(true);
      try {
        const body = new FormData();
        body.set('username', username);
        body.set('password', password);
        body.set('designatedIp', designatedIp);
        body.set('filePath', sourcePath);
        body.set('file', file);

        const res = await fetch('/api/architect/sftp/transfer', { method: 'POST', body });
        const json = await readJson(res);
        if (!res.ok) {
          note(false, `${file.name} — ${json.error ?? 'transfer refused'}`);
          return;
        }
        note(true, `${file.name} — ${json.data.message}`);
        await onTransferred();
      } catch (err) {
        note(false, `${file.name} — ${(err as Error).message}`);
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [password, username, designatedIp, sourcePath, onTransferred],
  );

  /** Files dropped from the left pane, or straight from the desktop. */
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);

    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      for (const f of dropped) await send(f);
      return;
    }
    // Dragged from the local pane: the payload is the entry's name.
    const name = e.dataTransfer.getData('text/plain');
    const entry = entries.find((en) => en.name === name);
    const file = entry?.file ?? (entry?.handle ? await entry.handle.getFile() : null);
    if (file) await send(file);
  }

  const connected = !!username && !!password;

  return (
    <div className="space-y-4">
      {/* Where the file is taken from — validated against the registration */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="tp-path" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          File path this is taken from
        </label>
        <input
          id="tp-path"
          value={sourcePath}
          onChange={(e) => setSourcePath(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
        />
        <p className="mt-2 text-xs text-slate-500">
          CIDCO checks both — your site name and this file path —
          against your registration on every transfer.
        </p>
      </div>

      {/* The two panes */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Local */}
        <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Your computer</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">{localName ?? 'no folder open'}</span>
            {trail.length > 1 && (
              <button onClick={goUp} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                ↑ Up
              </button>
            )}
            <button
              onClick={openFolder}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
            >
              Open folder
            </button>
            <input
              ref={folderInput}
              type="file"
              hidden
              multiple
              // @ts-expect-error - non-standard but universally supported
              webkitdirectory=""
              onChange={onFolderInput}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {entries.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-slate-400">
                Open the folder your AQI exports are written to, then drag a .csv across to CIDCO.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {entries.map((en) => {
                  const sendable = en.kind === 'file' && isSendable(en.name);
                  return (
                    <li key={en.name}>
                      <div
                        draggable={sendable}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', en.name);
                          setSelected(en.name);
                        }}
                        onDoubleClick={() => en.kind === 'directory' && enterDir(en)}
                        onClick={() => setSelected(en.name)}
                        className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${
                          selected === en.name ? 'bg-violet-50 text-violet-900' : 'hover:bg-slate-50'
                        } ${sendable ? 'cursor-grab' : ''}`}
                      >
                        <span className="text-slate-400">{en.kind === 'directory' ? '📁' : sendable ? '📄' : '·'}</span>
                        <span className={`min-w-0 flex-1 truncate ${sendable ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
                          {en.name}
                        </span>
                        {en.kind === 'file' && <span className="text-slate-400">{kb(en.size)}</span>}
                        {sendable && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const file = en.file ?? (en.handle ? await en.handle.getFile() : null);
                              if (file) await send(file);
                            }}
                            disabled={busy || !connected}
                            className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                          >
                            Send →
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Remote */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
          className={`flex min-h-[22rem] flex-col overflow-hidden rounded-xl border-2 shadow-sm transition-colors ${
            dropActive ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">CIDCO</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">
              {designatedIp}:{port} · {sourcePath}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {busy && <p className="px-2 py-2 text-xs font-medium text-violet-700">Sending…</p>}
            {delivered.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-slate-400">
                {connected
                  ? 'Drop a .csv here, or use Send → on the left.'
                  : 'Connect above, then drop a .csv here.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {delivered.map((d) => (
                  <li
                    key={d.id}
                    className={`rounded px-2 py-1.5 text-xs ${d.validationPassed ? 'hover:bg-slate-50' : 'bg-red-50'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">{d.validationPassed ? '📄' : '⚠'}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{d.fileName}</span>
                      <span className="text-slate-400">{kb(d.sizeBytes)}</span>
                    </div>
                    <p className={`mt-0.5 pl-6 ${d.validationPassed ? 'text-slate-500' : 'text-red-700'}`}>
                      {d.validationPassed
                        ? `${d.importedCount} of ${d.rowCount} rows stored${d.failedCount ? `, ${d.failedCount} rejected` : ''}`
                        : `refused — ${d.rejectionReason ?? 'validation failed'}`}
                      <span className="text-slate-400"> · {fmtTime(d.receivedAt)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Transfer log */}
      {log.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-xs text-slate-100">
          {log.map((l, i) => (
            <p key={i} className={l.ok ? 'text-emerald-300' : 'text-red-300'}>
              <span className="text-slate-500">{l.at}</span> {l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
