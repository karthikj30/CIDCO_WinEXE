'use client';

import { useId, useState } from 'react';

/**
 * The charts on the transfers page, as plain SVG.
 *
 * No chart library: the whole set is a line, a stacked column and a few stat
 * tiles, and a dependency for that would mean a lockfile change and an install
 * on the server for something a hundred lines of SVG does — while taking the
 * mark and colour decisions out of our hands.
 *
 * Colours are the validated categorical slots (blue, orange). Green/red was the
 * obvious choice for stored-versus-rejected and it fails: those two sit 4.1
 * apart under deuteranopia, so a red-green reader sees one colour. Blue/orange
 * measures 24.7 under protanopia and 33.6 for normal vision — and both series
 * are labelled anyway, so colour never carries the meaning alone.
 */

export const SERIES = {
  primary: '#2a78d6',
  secondary: '#eb6834',
  grid: '#e7e5e4',
  axis: '#78716c',
  ink: '#1c1917',
  muted: '#78716c',
} as const;

const fmtDay = (d: string) => {
  const [dd, mm] = d.split('_');
  return `${dd}/${mm}`;
};

/** A headline number. A one-bar chart would say less and take more room. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === 'warn' ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * AQI over time. One series, so no legend — the title names it — and the
 * hover layer is the thing that makes a line chart readable at all.
 */
export function AqiLineChart({ points }: { points: Array<{ at: string; aqi: number; station: string | null }> }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <Empty>Not enough readings yet to draw a trend.</Empty>;
  }

  const W = 760;
  const H = 240;
  const PAD = { top: 16, right: 16, bottom: 28, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = points.map((p) => p.aqi);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series still needs a band to sit in.
  const lo = Math.max(0, Math.floor((min - (max - min || 10) * 0.15) / 10) * 10);
  const hi = Math.ceil((max + (max - min || 10) * 0.15) / 10) * 10;

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.aqi).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${PAD.top + plotH} L${x(0).toFixed(1)},${PAD.top + plotH} Z`;

  const ticks = 4;
  const gridValues = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) / ticks) * i);
  const active = hover === null ? null : points[hover];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`AQI over time, ${points.length} readings`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((rel - PAD.left) / plotW) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.primary} stopOpacity="0.18" />
            <stop offset="100%" stopColor={SERIES.primary} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {gridValues.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={SERIES.grid} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill={SERIES.muted}>
              {Math.round(v)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line} fill="none" stroke={SERIES.primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {[0, points.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : 'end'}
            fontSize="10"
            fill={SERIES.muted}
          >
            {new Date(points[i].at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </text>
        ))}

        {active && hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={SERIES.axis}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* 2px surface ring, so the marker reads against the line */}
            <circle cx={x(hover)} cy={y(active.aqi)} r="5" fill={SERIES.primary} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>

      <figcaption className="mt-1 h-8 text-xs text-slate-600">
        {active ? (
          <span>
            <strong className="tabular-nums text-slate-900">AQI {active.aqi}</strong> ·{' '}
            {new Date(active.at).toLocaleString('en-IN')}
            {active.station ? ` · ${active.station}` : ''}
          </span>
        ) : (
          <span className="text-slate-400">Hover the line for a reading.</span>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * Files delivered per day, split into rows stored and rows rejected.
 *
 * Stacked because the two parts make up one delivery; the 2px gap between the
 * segments is what keeps them from reading as one block.
 */
export function DeliveriesChart({
  days,
}: {
  days: Array<{ dateFolder: string; files: number; stored: number; rejected: number }>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return <Empty>No deliveries yet.</Empty>;

  const W = 760;
  const H = 220;
  const PAD = { top: 16, right: 16, bottom: 30, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(...days.map((d) => d.stored + d.rejected), 1);
  const band = plotW / days.length;
  const barW = Math.min(46, Math.max(8, band * 0.62));
  const h = (v: number) => (v / max) * plotH;

  const ticks = 4;
  const active = hover === null ? null : days[hover];

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Rows stored and rejected per day">
        {Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i).map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + plotH - h(v)}
              y2={PAD.top + plotH - h(v)}
              stroke={SERIES.grid}
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={PAD.top + plotH - h(v) + 4} textAnchor="end" fontSize="10" fill={SERIES.muted}>
              {Math.round(v)}
            </text>
          </g>
        ))}

        {days.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          const storedH = h(d.stored);
          const rejectedH = h(d.rejected);
          const base = PAD.top + plotH;
          return (
            <g
              key={d.dateFolder}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              {/* A full-height target, so hovering does not demand precision */}
              <rect x={cx - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" />
              {d.rejected > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={base - storedH - rejectedH - 2}
                  width={barW}
                  height={Math.max(2, rejectedH)}
                  rx="4"
                  fill={SERIES.secondary}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              <rect
                x={cx - barW / 2}
                y={base - storedH}
                width={barW}
                height={Math.max(d.stored > 0 ? 2 : 0, storedH)}
                rx="4"
                fill={SERIES.primary}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {days.length <= 12 && (
                <text x={cx} y={H - 10} textAnchor="middle" fontSize="10" fill={SERIES.muted}>
                  {fmtDay(d.dateFolder)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs">
        <Key color={SERIES.primary} label="Rows stored" />
        <Key color={SERIES.secondary} label="Rows rejected" />
        <span className="ml-auto h-4 text-slate-600">
          {active
            ? `${fmtDay(active.dateFolder)} · ${active.files} file(s) · ${active.stored} stored${
                active.rejected ? ` · ${active.rejected} rejected` : ''
              }`
            : ''}
        </span>
      </div>
    </figure>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-600">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
      {children}
    </div>
  );
}
