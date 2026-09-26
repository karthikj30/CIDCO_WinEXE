'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import { AQI_BANDS, BAND_COLOR, bandLabel, type AqiBandKey } from '@/lib/aqi';

/**
 * The monitoring dashboard's charts, drawn with amCharts 5.
 *
 * Each chart builds its own root in an effect and disposes it on unmount —
 * amCharts writes straight to the DOM, so it cannot run during a server
 * render and must be torn down by hand or the page leaks a renderer per
 * filter change.
 *
 * Colours are passed in rather than taken from an amCharts theme: the palette
 * is validated elsewhere, and a theme would quietly cycle its own hues once a
 * filter changed the series count, repainting series that did not change.
 */

const INK = am5.color(0x1c1917);
const MUTED = am5.color(0x78716c);
const GRID = am5.color(0xe7e5e4);

/** Everything a chart needs before amCharts will draw: a sized, client-side box. */
function useChart(build: (root: am5.Root) => void, deps: unknown[]) {
  const holder = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!holder.current) return;
    const root = am5.Root.new(holder.current);
    root.setThemes([am5themes_Animated.new(root)]);
    // The amCharts logo is only added on the free licence; when CIDCO holds a
    // licence, set NEXT_PUBLIC_AMCHARTS_LICENCE and this removes it.
    const licence = process.env.NEXT_PUBLIC_AMCHARTS_LICENCE;
    if (licence) am5.addLicense(licence);
    build(root);
    return () => root.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return holder;
}

export function Empty({ note, height = 260 }: { note: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400"
      style={{ height }}
    >
      {note}
    </div>
  );
}

export function ChartCard({
  title, subtitle, right, children,
}: {
  title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode;
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

/** Shared axis dressing, so every chart reads the same way. */
function styleAxis(axis: am5xy.Axis<am5xy.AxisRenderer>) {
  const renderer = axis.get('renderer');
  renderer.labels.template.setAll({ fill: MUTED, fontSize: 11 });
  renderer.grid.template.setAll({ stroke: GRID, strokeDasharray: [3, 4], strokeOpacity: 1 });
}

/**
 * Site names are long and there are a lot of them, so horizontal labels run
 * into each other — "Dronagiri Node 4" and "Kharghar Sector 12" were printing
 * on top of one another. Angled and truncated, with the full name in the
 * tooltip, every bar keeps a readable label.
 */
function styleCategoryLabels(axis: am5xy.CategoryAxis<am5xy.AxisRenderer>) {
  axis.get('renderer').labels.template.setAll({
    rotation: -35,
    centerY: am5.p50,
    centerX: am5.p100,
    maxWidth: 110,
    oversizedBehavior: 'truncate',
    fontSize: 11,
    fill: MUTED,
  });
}

// ---------------------------------------------------------------------------
// Lines over time
// ---------------------------------------------------------------------------

export type Series = {
  key: string;
  label: string;
  color: string;
  points: Array<{ at: string; value: number }>;
};

/**
 * One or more measures over time.
 *
 * Always a single shared y-axis. Two measures of different scale get two
 * charts, never a second axis: that is the one chart mistake that invents
 * crossings a reader will believe.
 */
export function TrendChart({
  series, height = 280, unit = '', fill = false,
}: {
  series: Series[];
  height?: number;
  unit?: string;
  /** An area under the line, for a single series where the level is the point. */
  fill?: boolean;
}) {
  const holder = useChart((root) => {
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelY: 'none', layout: root.verticalLayout }),
    );

    const xAxis = chart.xAxes.push(
      am5xy.DateAxis.new(root, {
        baseInterval: { timeUnit: 'minute', count: 1 },
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 70 }),
        tooltip: am5.Tooltip.new(root, {}),
      }),
    );
    // A line is read for its shape, so the axis is allowed to start above
    // zero — but only when the data actually sits well above it. A series
    // that runs down to near zero keeps a zero floor, because padding below
    // it puts negative concentrations on the axis, and there is no such
    // thing as -200 µg/m³.
    const values = series.flatMap((s) => s.points.map((p) => p.value));
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    const floorAtZero = lo <= 0 || lo < hi * 0.2;

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        ...(floorAtZero ? { min: 0 } : { extraMin: 0.12 }),
        extraMax: 0.12,
        renderer: am5xy.AxisRendererY.new(root, {}),
      }),
    );
    styleAxis(xAxis);
    styleAxis(yAxis);

    for (const s of series) {
      const line = chart.series.push(
        am5xy.LineSeries.new(root, {
          name: s.label,
          xAxis,
          yAxis,
          valueYField: 'value',
          valueXField: 'at',
          stroke: am5.color(s.color),
          fill: am5.color(s.color),
          tooltip: am5.Tooltip.new(root, { labelText: `{name}: {valueY}${unit}` }),
        }),
      );
      line.strokes.template.setAll({ strokeWidth: 2 });
      if (fill && series.length === 1) {
        line.fills.template.setAll({ fillOpacity: 0.18, visible: true });
      }
      // A marker on every point, with a surface ring so two series that meet
      // still read as two marks.
      line.bullets.push(() =>
        am5.Bullet.new(root, {
          sprite: am5.Circle.new(root, {
            radius: 4,
            fill: am5.color(s.color),
            stroke: am5.color(0xffffff),
            strokeWidth: 1.5,
          }),
        }),
      );
      line.data.setAll(s.points.map((p) => ({ at: new Date(p.at).getTime(), value: p.value })));
      line.appear(600);
    }

    // A crosshair, so a reader can line a value up with its moment.
    chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis }));

    if (series.length > 1) {
      const legend = chart.children.push(
        am5.Legend.new(root, { centerX: am5.p50, x: am5.p50, marginTop: 8 }),
      );
      legend.labels.template.setAll({ fill: INK, fontSize: 12 });
      legend.data.setAll(chart.series.values);
    }

    chart.appear(600);
  }, [JSON.stringify(series.map((s) => [s.key, s.color, s.points.length, s.points[0]?.at, s.points.at(-1)?.at])), fill]);

  if (series.length === 0 || series.every((s) => s.points.length === 0)) {
    return <Empty note="No readings in this window." height={height} />;
  }
  return <div ref={holder} style={{ width: '100%', height }} />;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type Column = { label: string; value: number; color: string; note?: string };

/** Magnitude across a handful of named things, anchored to zero. */
export function ColumnChart({ columns, height = 320 }: { columns: Column[]; height?: number }) {
  const holder = useChart((root) => {
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelY: 'none' }),
    );

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'label',
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 20 }),
      }),
    );
    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, { min: 0, renderer: am5xy.AxisRendererY.new(root, {}) }),
    );
    styleAxis(xAxis);
    styleAxis(yAxis);
    styleCategoryLabels(xAxis);
    xAxis.get('renderer').grid.template.set('visible', false);

    const series = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        xAxis, yAxis,
        valueYField: 'value',
        categoryXField: 'label',
        tooltip: am5.Tooltip.new(root, { labelText: '{label}: {valueY}\n{note}' }),
      }),
    );
    series.columns.template.setAll({
      // 4px rounded tops anchored to the baseline; a floating or clipped bar
      // misstates every comparison a reader makes from its length.
      cornerRadiusTL: 4,
      cornerRadiusTR: 4,
      strokeOpacity: 0,
      width: am5.percent(62),
      templateField: 'settings',
    });

    // The value above each bar: selective labels, not a number on every point
    // of a dense series.
    series.bullets.push(() =>
      am5.Bullet.new(root, {
        locationY: 1,
        sprite: am5.Label.new(root, {
          text: '{valueY}',
          centerX: am5.p50,
          centerY: am5.p100,
          dy: -4,
          populateText: true,
          fontSize: 11,
          fontWeight: '600',
          fill: INK,
        }),
      }),
    );

    const data = columns.map((c) => ({
      label: c.label,
      value: c.value,
      note: c.note ?? '',
      settings: { fill: am5.color(c.color) },
    }));
    xAxis.data.setAll(data);
    series.data.setAll(data);
    series.appear(600);
    chart.appear(600);
  }, [JSON.stringify(columns)]);

  if (columns.length === 0) return <Empty note="Nothing to show for these filters." height={height} />;
  return <div ref={holder} style={{ width: '100%', height }} />;
}

/**
 * How many readings each site spent in each band, stacked per site.
 *
 * The bands are an ordered severity, so they are one hue light to dark rather
 * than six colours, and the legend names every one.
 */
export function StackedBandChart({
  rows, height = 340,
}: {
  rows: Array<{ siteName: string; counts: Record<AqiBandKey, number>; total: number }>;
  height?: number;
}) {
  const holder = useChart((root) => {
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelY: 'none', layout: root.verticalLayout }),
    );

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'siteName',
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 20 }),
      }),
    );
    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, { min: 0, renderer: am5xy.AxisRendererY.new(root, {}) }),
    );
    styleAxis(xAxis);
    styleAxis(yAxis);
    styleCategoryLabels(xAxis);
    xAxis.get('renderer').grid.template.set('visible', false);

    const data = rows.map((r) => ({ siteName: r.siteName, ...r.counts }));
    xAxis.data.setAll(data);

    for (const band of AQI_BANDS) {
      const series = chart.series.push(
        am5xy.ColumnSeries.new(root, {
          name: band.label,
          stacked: true,
          xAxis, yAxis,
          valueYField: band.key,
          categoryXField: 'siteName',
          fill: am5.color(BAND_COLOR[band.key]),
          stroke: am5.color(BAND_COLOR[band.key]),
          tooltip: am5.Tooltip.new(root, { labelText: '{name}: {valueY} of {siteName}' }),
        }),
      );
      series.columns.template.setAll({
        width: am5.percent(62),
        strokeOpacity: 0,
        // 2px of surface between segments, so a stack reads as parts.
        marginBottom: 2,
      });
      series.data.setAll(data);
      series.appear(600);
    }

    const legend = chart.children.push(
      am5.Legend.new(root, { centerX: am5.p50, x: am5.p50, marginTop: 8 }),
    );
    legend.labels.template.setAll({ fill: INK, fontSize: 12 });
    legend.data.setAll(chart.series.values);

    chart.appear(600);
  }, [JSON.stringify(rows)]);

  if (rows.length === 0) return <Empty note="No readings in this window." height={height} />;
  return <div ref={holder} style={{ width: '100%', height }} />;
}

export { bandLabel };
