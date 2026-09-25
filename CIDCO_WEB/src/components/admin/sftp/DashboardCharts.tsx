'use client';

import { useId, useMemo, useState } from 'react';
import { AQI_BANDS, BAND_COLOR, bandLabel, type AqiBandKey } from '@/lib/aqi';

/**
 * The monitoring dashboard's charts, as plain SVG.
 *
 * No chart library, for the same reason the transfers charts have none: the
 * set is a line, two column charts and a stacked bar, and a dependency for
 * that would take the mark and colour decisions out of our hands while adding
 * an install step on CIDCO's server.
 *
 * Every chart here has a hover layer, a legend whenever more than one series
 * is on screen, and axis labels in ink rather than in the series colour.
 */

const INK = '#1c1917';
const MUTED = '#78716c';
const GRID = '#e7e5e4';
const AXIS = '#c3c2b7';

const PAD = { top: 16, right: 16, bottom: 34, left: 46 };

/** A nice round top for an axis, so the gridlines land on readable numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(value)) - 1) * 5;
  return Math.max(step, Math.ceil(value / step) * step);
}

function ticks(max: number, count = 4, min = 0): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round(min + ((max - min) / count) * i));
}

/**
 * The y-range for a line chart.
 *
 * A line is read for its shape, and forcing it to a zero baseline flattens
 * every AQI series into a straight line near the top of an empty chart. Bars
 * are a different matter — their length is the value, so those stay anchored
 * to zero.
 */
function lineRange(values: number[]): { min: number; max: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return { min: Math.max(0, lo - 1), max: hi + 1 };
  const pad = (hi - lo) * 0.15;
  const step = Math.pow(10, Math.floor(Math.log10(hi - lo)) - 1) * 5 || 1;
  return {
    min: Math.max(0, Math.floor((lo - pad) / step) * step),
    max: Math.ceil((hi + pad) / step) * step,
  };
}

/** hh:mm for an hourly bucket, dd/mm for a daily one. */
function timeLabel(iso: string, bucket: 'hour' | 'day'): string {
  const d = new Date(iso);
  return bucket === 'hour'
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit' });
}

export function ChartCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <figcaption className="text-sm font-bold text-slate-900">{title}</figcaption>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </figure>
  );
}

export function Empty({ note }: { note: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
      {note}
    </div>
  );
}

/** A colour chip beside a name. Identity is never the colour alone. */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="mt-3 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 1 & 2. Trends over time
// ---------------------------------------------------------------------------

export type Series = { key: string; label: string; color: string; points: Array<{ at: string; value: number }> };

/**
 * One or more measures over time.
 *
 * A single shared y-axis, always: two pollutants of different scale get two
 * charts or a common index, never a second axis — that is the one chart
 * mistake that makes a reader believe a crossing means something.
 */
export function TrendChart({
  series,
  bucket,
  height = 260,
  unit = '',
}: {
  series: Series[];
  bucket: 'hour' | 'day';
  height?: number;
  unit?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;

  const stamps = useMemo(() => {
    const all = new Set<string>();
    for (const s of series) for (const p of s.points) all.add(p.at);
    return [...all].sort();
  }, [series]);

  if (stamps.length === 0) return <Empty note="No readings in this window." />;

  const all = series.flatMap((s) => s.points.map((p) => p.value));
  const { min, max } = lineRange(all.length ? all : [0, 1]);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (stamps.length === 1 ? plotW / 2 : (plotW * i) / (stamps.length - 1));
  const y = (v: number) => PAD.top + plotH - (plotH * (v - min)) / (max - min);

  const at = new Map(series.map((s) => [s.key, new Map(s.points.map((p) => [p.at, p.value]))]));
  const labelEvery = Math.max(1, Math.ceil(stamps.length / 7));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-labelledby={`${id}-t`}
        onMouseLeave={() => setHover(null)}
      >
        <title id={`${id}-t`}>{series.map((s) => s.label).join(', ')} over time</title>

        {ticks(max, 4, min).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{t}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(min)} y2={y(min)} stroke={AXIS} />

        {stamps.map((s, i) =>
          i % labelEvery === 0 ? (
            <text key={s} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill={MUTED}>
              {timeLabel(s, bucket)}
            </text>
          ) : null,
        )}

        {series.map((s) => {
          const pts = stamps
            .map((stamp, i) => ({ i, v: at.get(s.key)!.get(stamp) }))
            .filter((p): p is { i: number; v: number } => p.v !== undefined);
          if (pts.length === 0) return null;
          const d = pts.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ');
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />
              ))}
            </g>
          );
        })}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(min)} stroke={MUTED} strokeDasharray="3 3" />
        )}
        {hover !== null &&
          series.map((s) => {
            const v = at.get(s.key)!.get(stamps[hover]);
            return v === undefined ? null : (
              // A 2px surface ring keeps two series that meet at a point
              // readable as two marks rather than one blob.
              <circle key={s.key} cx={x(hover)} cy={y(v)} r="5" fill={s.color} stroke="#fff" strokeWidth="2" />
            );
          })}

        {/* Wide invisible targets: the hit area is the column, not the dot. */}
        {stamps.map((s, i) => (
          <rect
            key={s}
            x={x(i) - plotW / Math.max(1, stamps.length) / 2}
            y={PAD.top}
            width={plotW / Math.max(1, stamps.length)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <p className="min-h-[18px] text-center text-xs text-slate-600">
        {hover === null ? (
          <span className="text-slate-400">Hover for a reading.</span>
        ) : (
          <>
            <strong className="text-slate-900">{timeLabel(stamps[hover], bucket)}</strong>
            {series.map((s) => {
              const v = at.get(s.key)!.get(stamps[hover]);
              return v === undefined ? null : (
                <span key={s.key} className="ml-3 whitespace-nowrap">
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: s.color }}
                  />
                  {s.label} {v}
                  {unit}
                </span>
              );
            })}
          </>
        )}
      </p>

      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 & 5. Column charts
// ---------------------------------------------------------------------------

export type Column = { label: string; value: number; color: string; note?: string };

/**
 * Magnitude across a handful of named things.
 *
 * Bars are anchored to the baseline with rounded tops — a bar that floats or
 * starts above zero misstates every comparison a reader makes from length.
 */
export function ColumnChart({
  columns,
  height = 260,
  valueLabel,
}: {
  columns: Column[];
  height?: number;
  valueLabel?: (c: Column) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;

  if (columns.length === 0) return <Empty note="Nothing to show for these filters." />;

  const max = niceMax(Math.max(...columns.map((c) => c.value), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / columns.length;
  // A 2px gap of surface between neighbours, so two tall bars never merge.
  const barW = Math.min(76, slot - 12);
  const y = (v: number) => PAD.top + plotH - (plotH * v) / max;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`}
           onMouseLeave={() => setHover(null)}>
        <title id={`${id}-t`}>{columns.map((c) => `${c.label} ${c.value}`).join(', ')}</title>

        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{t}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke={AXIS} />

        {columns.map((c, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const top = y(c.value);
          return (
            <g key={c.label} onMouseEnter={() => setHover(i)}>
              <rect
                x={cx - barW / 2}
                y={top}
                width={barW}
                height={Math.max(1, y(0) - top)}
                rx="4"
                fill={c.color}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              <text x={cx} y={top - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={INK}>
                {valueLabel ? valueLabel(c) : c.value}
              </text>
              <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill={MUTED}>
                {c.label.length > 14 ? `${c.label.slice(0, 13)}…` : c.label}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="min-h-[18px] text-center text-xs text-slate-600">
        {hover === null ? (
          <span className="text-slate-400">Hover a bar.</span>
        ) : (
          <>
            <strong className="text-slate-900">{columns[hover].label}</strong>{' '}
            {columns[hover].value}
            {columns[hover].note ? <span className="text-slate-500"> · {columns[hover].note}</span> : null}
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. AQI category distribution
// ---------------------------------------------------------------------------

/**
 * How many readings each site spent in each band, stacked per site.
 *
 * The bands are an ordered severity, so they are one hue light to dark rather
 * than six colours — and every segment is named in the legend and the hover
 * readout, so the ordering does the work rather than the colour.
 */
export function StackedBandChart({
  rows,
  height = 280,
}: {
  rows: Array<{ siteName: string; counts: Record<AqiBandKey, number>; total: number }>;
  height?: number;
}) {
  const id = useId();
  const [hover, setHover] = useState<{ row: number; band: AqiBandKey } | null>(null);
  const W = 720;
  const H = height;

  if (rows.length === 0) return <Empty note="No readings in this window." />;

  const max = niceMax(Math.max(...rows.map((r) => r.total), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / rows.length;
  const barW = Math.min(76, slot - 12);
  const y = (v: number) => PAD.top + plotH - (plotH * v) / max;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`}
           onMouseLeave={() => setHover(null)}>
        <title id={`${id}-t`}>Readings per AQI band for each site</title>

        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{t}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke={AXIS} />

        {rows.map((r, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          let running = 0;
          return (
            <g key={r.siteName}>
              {AQI_BANDS.map((b) => {
                const n = r.counts[b.key];
                if (!n) return null;
                const top = y(running + n);
                // 2px of surface between segments keeps the stack legible.
                const h = Math.max(1, y(running) - top - 2);
                running += n;
                return (
                  <rect
                    key={b.key}
                    x={cx - barW / 2}
                    y={top}
                    width={barW}
                    height={h}
                    rx="2"
                    fill={BAND_COLOR[b.key]}
                    opacity={hover === null || (hover.row === i && hover.band === b.key) ? 1 : 0.6}
                    onMouseEnter={() => setHover({ row: i, band: b.key })}
                  />
                );
              })}
              <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill={MUTED}>
                {r.siteName.length > 14 ? `${r.siteName.slice(0, 13)}…` : r.siteName}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="min-h-[18px] text-center text-xs text-slate-600">
        {hover === null ? (
          <span className="text-slate-400">Hover a segment.</span>
        ) : (
          <>
            <strong className="text-slate-900">{rows[hover.row].siteName}</strong>
            <span
              className="ml-3 mr-1 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: BAND_COLOR[hover.band] }}
            />
            {bandLabel(hover.band)} — {rows[hover.row].counts[hover.band]} of {rows[hover.row].total} readings
          </>
        )}
      </p>

      <Legend items={AQI_BANDS.map((b) => ({ label: b.label, color: BAND_COLOR[b.key] }))} />
    </div>
  );
}
