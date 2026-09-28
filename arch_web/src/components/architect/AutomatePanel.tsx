'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredTokens } from './useTokens';
import { relativeTime } from './useTokens';
import { readJson } from '@/lib/fetchJson';

type LogLine = {
  at: string;
  ok: boolean;
  status: number;
  text: string;
  reason?: string;
  action?: string;
};

const READING = {
  projectSiteId: 'CIDCO-KHR-012',
  monitoringStationId: 'STN-KHR-07',
  oem: 'Aeroqual',
  deviceModel: 'AQY-1',
  aqiValue: '168',
  pm25: '72.1',
  pm10: '150.4',
  no2: '41.2',
  so2: '12.7',
  co: '0.9',
  ozone: '48.6',
  temperature: '33.4',
  humidity: '62.1',
};

// 3 hours is the real cadence; the short options make the loop observable.
const INTERVALS = [
  { label: 'Every 3 hours', ms: 3 * 60 * 60 * 1000 },
  { label: 'Every 1 hour', ms: 60 * 60 * 1000 },
  { label: 'Every 1 minute (test)', ms: 60 * 1000 },
  { label: 'Every 15 seconds (demo)', ms: 15 * 1000 },
];

export default function AutomatePanel({
  tokens,
  saveTokens,
  reload,
}: {
  tokens: StoredTokens;
  saveTokens: (t: StoredTokens) => void;
  reload: () => Promise<void>;
}) {
  const [tokenInput, setTokenInput] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [form, setForm] = useState({ ...READING });
  const [intervalMs, setIntervalMs] = useState(INTERVALS[3].ms);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const halted = useRef(false);

  function set(k: keyof typeof READING) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));
  }

  const sendOnce = useCallback(async () => {
    const body: Record<string, unknown> = { measuredAt: new Date().toISOString(), integrationMethod: 'Automated API' };
    for (const [k, v] of Object.entries(form)) if (v !== '') body[k] = v;

    try {
      const res = await fetch('/api/architect/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.accessToken ?? ''}` },
        body: JSON.stringify(body),
      });
      const json = await readJson(res);
      const line: LogLine = {
        at: new Date().toLocaleTimeString('en-IN'),
        ok: res.ok,
        status: res.status,
        text: res.ok
          ? `Stored — ${json.data?.report?.referenceNo ?? 'accepted'} (AQI ${json.data?.report?.aqiValue})`
          : (json.error ?? 'Rejected'),
        reason: json.details?.reason,
        action: json.details?.action,
      };
      setLog((p) => [line, ...p].slice(0, 40));

      // A token problem stops the loop — the architect must act.
      if (!res.ok && (json.details?.reason === 'ACCESS_EXPIRED' || json.details?.reason === 'BOTH_EXPIRED')) {
        halted.current = true;
        setRunning(false);
      }
      if (res.ok) await reload();
    } catch (err) {
      setLog((p) => [
        { at: new Date().toLocaleTimeString('en-IN'), ok: false, status: 0, text: (err as Error).message },
        ...p,
      ].slice(0, 40));
    }
  }, [form, tokens.accessToken, reload]);

  // The automation loop. Runs while this tab is open.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!running) {
      setNextAt(null);
      return;
    }
    void sendOnce();
    setNextAt(Date.now() + intervalMs);
    timer.current = setInterval(() => {
      void sendOnce();
      setNextAt(Date.now() + intervalMs);
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, intervalMs, sendOnce]);

  // Re-render once a second so the countdown moves.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
  const accessDead = tokens.accessExpiresAt ? new Date(tokens.accessExpiresAt).getTime() <= Date.now() : false;
  const lastFailure = log.find((l) => !l.ok && (l.reason === 'ACCESS_EXPIRED' || l.reason === 'BOTH_EXPIRED'));

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Send AQI data</h2>
        <p className="mt-1 text-sm text-slate-500">
          Put the access token CIDCO gave you here, then click <strong>Automate</strong>. Each run posts
          the reading to CIDCO with the access token as the header and the data as the body.
        </p>
      </div>

      {/* 1 — update the access token */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">1. Update your access token</h3>
        <p className="mt-1 text-xs text-slate-500">
          Paste the token from the <strong>Messages</strong> tab. Current:{' '}
          {tokens.accessToken ? (
            <>
              <span className="font-mono text-slate-700">{tokens.accessToken.slice(0, 18)}…</span>{' '}
              <span className={accessDead ? 'font-semibold text-red-600' : 'text-slate-500'}>
                ({relativeTime(tokens.accessExpiresAt)})
              </span>
            </>
          ) : (
            <span className="text-amber-700">none saved</span>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="cidco_tok_…"
            className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={() => {
              if (!tokenInput.trim()) return;
              saveTokens({ accessToken: tokenInput.trim(), accessExpiresAt: undefined });
              setTokenInput('');
              halted.current = false;
              setSaved('Access token updated. You can start automating.');
            }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Update token
          </button>
        </div>
        {saved && <p className="mt-2 text-xs font-medium text-emerald-700">{saved}</p>}
      </div>

      {/* 2 — the reading */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">2. Reading sent on each run</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(
            [
              ['projectSiteId', 'Project / Site ID'], ['monitoringStationId', 'Station / Device ID'],
              ['oem', 'OEM'], ['deviceModel', 'Model'], ['aqiValue', 'AQI value *'],
              ['pm25', 'PM2.5'], ['pm10', 'PM10'], ['no2', 'NO₂'], ['so2', 'SO₂'],
              ['co', 'CO'], ['ozone', 'O₃'], ['temperature', 'Temp °C'], ['humidity', 'Humidity %'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`au-${key}`} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
              <input id={`au-${key}`} value={form[key]} onChange={set(key)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">The reading time is stamped fresh on every run.</p>
      </div>

      {/* 3 — automate */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">3. Automate</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
            disabled={running}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
          >
            {INTERVALS.map((i) => <option key={i.ms} value={i.ms}>{i.label}</option>)}
          </select>

          {running ? (
            <button onClick={() => setRunning(false)}
              className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700">
              Stop
            </button>
          ) : (
            <button
              onClick={() => { halted.current = false; setRunning(true); }}
              disabled={!tokens.accessToken}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Automate
            </button>
          )}

          <button onClick={() => void sendOnce()} disabled={!tokens.accessToken || running}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Send once
          </button>

          {running && (
            <span className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Running — next send in {secondsLeft}s
            </span>
          )}
        </div>

        {!tokens.accessToken && (
          <p className="mt-2 text-xs text-amber-700">Save an access token above before automating.</p>
        )}

        {lastFailure && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">Automation stopped — {lastFailure.text}</p>
            <p className="mt-1 text-xs">
              {lastFailure.reason === 'ACCESS_EXPIRED'
                ? 'Go to the Connection tab and request a new access token with your refresh token. When CIDCO approves it, the new token appears under Messages — paste it above and press Automate again.'
                : 'Both tokens have expired. Go to the Connection tab and validate again with your user id and password.'}
            </p>
          </div>
        )}
      </div>

      {/* run log */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Send log</h3>
        </div>
        {log.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing sent yet.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-auto">
            {log.map((l, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-2.5 text-xs">
                <span className="w-16 shrink-0 text-slate-400">{l.at}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono font-bold ${l.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {l.status || 'ERR'}
                </span>
                <span className={l.ok ? 'text-slate-700' : 'text-red-700'}>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-400">
        The loop runs while this tab is open — closing it stops the automation. A real monitoring
        station would run the same call from its own scheduler (cron, or a Postman monitor).
      </p>
    </div>
  );
}
