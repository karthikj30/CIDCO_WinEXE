'use client';

import type { MeData } from './ArchitectWorkspace';
import { fmt } from './useTokens';

const AQI_COLOR = (a: number) =>
  a <= 50 ? 'bg-emerald-100 text-emerald-800'
    : a <= 100 ? 'bg-lime-100 text-lime-800'
    : a <= 200 ? 'bg-amber-100 text-amber-800'
    : a <= 300 ? 'bg-orange-100 text-orange-800'
    : a <= 400 ? 'bg-red-100 text-red-800'
    : 'bg-rose-200 text-rose-900';

export default function MyReadingsPanel({ me }: { me: MeData }) {
  const rows = me.recentReadings;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">My readings</h2>
        <p className="mt-1 text-sm text-slate-500">
          {me.readingCount} reading{me.readingCount === 1 ? '' : 's'} accepted by CIDCO — most recent first.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
              <tr>
                {['Reference', 'Received by CIDCO', 'Measured', 'Site', 'Station', 'AQI', 'PM2.5', 'PM10', 'Temp', 'Humidity', 'Source', 'Status'].map((c) => (
                  <th key={c} className="px-3 py-2.5 font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-500">
                  Nothing sent yet — use the <strong>Send AQI data</strong> tab.
                </td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-emerald-700">{r.referenceNo}</td>
                    <td className="px-3 py-2 text-slate-500">{fmt(r.receivedAt)}</td>
                    <td className="px-3 py-2 text-slate-500">{fmt(r.measuredAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{r.projectSiteId ?? r.siteName}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{r.monitoringStationId ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded px-1.5 py-0.5 font-semibold ${AQI_COLOR(r.aqiValue)}`}>{r.aqiValue}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.pm25 ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.pm10 ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.temperature ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.humidity ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.source}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{r.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
