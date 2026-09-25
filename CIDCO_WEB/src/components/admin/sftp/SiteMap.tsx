'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
// Static, so Next bundles the stylesheet; only the library itself has to wait
// for the browser.
import 'leaflet/dist/leaflet.css';
import {
  BAND_STATUS_COLOR, POLLUTANTS, REPORTING,
  bandLabel, describeDistance,
  type AqiBandKey, type ReportingKey,
} from '@/lib/aqi';

/**
 * The monitoring map: every site CIDCO holds, where its data is coming from,
 * and whether that is where the site was registered.
 *
 * Leaflet with OpenStreetMap tiles — both free and open, which matters for a
 * portal an authority runs. Leaflet touches `window` on import, so it is
 * pulled in from inside an effect rather than at module scope; Next would
 * otherwise try to evaluate it while rendering on the server.
 *
 * A marker carries two things at once: its fill is the AQI band, and its ring
 * is the reporting status. Both are written out in the panel that opens when
 * you click it, so neither is read from colour alone.
 */

export type MapSite = {
  id: string;
  siteName: string;
  node: string | null;
  department: string | null;
  contractor: string | null;
  address: string | null;
  stationId: string | null;
  projectSiteId: string | null;
  aqi: number | null;
  band: AqiBandKey | null;
  measuredAt: string | null;
  pollutants: Record<string, number | null>;
  registered: { latitude: number | null; longitude: number | null };
  reported: { latitude: number | null; longitude: number | null };
  permittedRadiusMetres: number;
  location: { status: string; metres: number | null; withinRadius: boolean | null };
  reporting: ReportingKey;
  lastDeliveryAt: string | null;
  lastDeliveredName: string | null;
  readingCount: number;
};

/** Where a marker goes: where the data said it came from, else where CIDCO registered it. */
function pointOf(s: MapSite): [number, number] | null {
  if (s.reported.latitude !== null && s.reported.longitude !== null) {
    return [s.reported.latitude, s.reported.longitude];
  }
  return registeredOf(s);
}

function registeredOf(s: MapSite): [number, number] | null {
  if (s.registered.latitude !== null && s.registered.longitude !== null) {
    return [s.registered.latitude, s.registered.longitude];
  }
  return null;
}

/** Navi Mumbai, where CIDCO's nodes are, for a map with nothing to frame yet. */
const HOME: [number, number] = [19.033, 73.0297];
const HOME_ZOOM = 10;

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function SiteMap({ sites }: { sites: MapSite[] }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const [selected, setSelected] = useState<MapSite | null>(null);
  const [ready, setReady] = useState(false);

  const placed = useMemo(() => sites.filter((s) => pointOf(s) !== null), [sites]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !holder.current || map.current) return;

      map.current = L.map(holder.current, { scrollWheelZoom: false }).setView(HOME, HOME_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map.current);
      markers.current = L.layerGroup().addTo(map.current);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current || !markers.current) return;

    (async () => {
      const L = (await import('leaflet')).default;
      markers.current!.clearLayers();

      for (const s of placed) {
        const point = pointOf(s)!;
        const fill = s.band ? BAND_STATUS_COLOR[s.band] : '#898781';
        const ring = REPORTING[s.reporting].color;

        // The permitted radius, drawn so a marker sitting outside its own
        // circle is visible without opening anything.
        if (s.registered.latitude !== null && s.registered.longitude !== null) {
          L.circle([s.registered.latitude, s.registered.longitude], {
            radius: s.permittedRadiusMetres,
            color: s.location.status === 'MISMATCH' ? '#d03b3b' : '#78716c',
            weight: 1,
            fillOpacity: 0.05,
            dashArray: '4 4',
          }).addTo(markers.current!);
        }

        const marker = L.circleMarker(point, {
          radius: 10,
          fillColor: fill,
          fillOpacity: 0.95,
          color: ring,
          weight: 3,
        }).addTo(markers.current!);

        marker.bindTooltip(
          `${s.siteName} — AQI ${s.aqi ?? '—'} ${bandLabel(s.band)}`,
          { direction: 'top' },
        );
        marker.on('click', () => setSelected(s));
      }

      // Frame the registered positions, not the reported ones.
      //
      // A delivery can report anywhere — a test file named "…_1_2_AQI.csv"
      // parses as 1°N 2°E, in the Atlantic — and framing that pulls the whole
      // map off Navi Mumbai and hides every real site. Where CIDCO registered
      // its sites is the fixed, trustworthy frame; a marker that lands outside
      // it is the finding, and the mismatch count and the table both say so.
      const frame = placed.map((s) => registeredOf(s)).filter((p): p is [number, number] => p !== null);
      if (frame.length > 0) {
        map.current!.fitBounds(frame, { padding: [40, 40], maxZoom: 14 });
      } else if (placed.length > 0) {
        map.current!.fitBounds(placed.map((s) => pointOf(s)!), { padding: [40, 40], maxZoom: 14 });
      } else {
        map.current!.setView(HOME, HOME_ZOOM);
      }
      // Leaflet measures its box on creation; the card is still laying out at
      // that point, so a first paint can come out a sliver tall.
      map.current!.invalidateSize();
    })();
  }, [placed, ready]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">AQI monitoring map</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Fill is the AQI band, ring is the reporting status. The dashed circle is the permitted
            radius around the registered position — a marker outside its own circle is data arriving
            from somewhere else.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {placed.length} of {sites.length} sites have a position
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div ref={holder} className="h-[420px] w-full rounded-lg border border-slate-200" />

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
          {selected ? <Detail site={selected} /> : (
            <p className="text-slate-500">
              Click a marker for the site&rsquo;s readings, and how far its data arrived from the
              registered position.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-500">Band</span>
        {(Object.keys(BAND_STATUS_COLOR) as AqiBandKey[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_STATUS_COLOR[k] }} />
            {bandLabel(k)}
          </span>
        ))}
        <span className="ml-2 font-semibold text-slate-500">Status</span>
        {(Object.keys(REPORTING) as ReportingKey[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full border-2 bg-white"
              style={{ borderColor: REPORTING[k].color }}
            />
            {REPORTING[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function Detail({ site }: { site: MapSite }) {
  const loc = site.location;
  const locationLine =
    loc.status === 'MATCH' ? `✓ within ${site.permittedRadiusMetres} m`
    : loc.status === 'MISMATCH' ? `✕ outside the permitted ${site.permittedRadiusMetres} m`
    : loc.status === 'NO_REGISTERED' ? 'no registered position on the master'
    : 'the delivery carried no position';

  return (
    <div>
      <p className="text-sm font-bold text-slate-900">{site.siteName}</p>
      <p className="mt-0.5 text-slate-500">
        {[site.node, site.department].filter(Boolean).join(' · ') || 'no node or department'}
      </p>

      <dl className="mt-3 border-t border-slate-200 pt-2">
        <Row label="Project / Site ID">{site.projectSiteId ?? '—'}</Row>
        <Row label="Station ID">{site.stationId ?? '—'}</Row>
        <Row label="Contractor">{site.contractor ?? '—'}</Row>
        <Row label="Current AQI">
          {site.aqi ?? '—'}
          {site.band && (
            <span className="ml-1.5 rounded px-1.5 py-0.5 text-white" style={{ background: BAND_STATUS_COLOR[site.band] }}>
              {bandLabel(site.band)}
            </span>
          )}
        </Row>
      </dl>

      <dl className="mt-2 border-t border-slate-200 pt-2">
        {POLLUTANTS.map((p) => (
          <Row key={p.key} label={p.label}>{site.pollutants[p.key] ?? '—'}</Row>
        ))}
      </dl>

      <dl className="mt-2 border-t border-slate-200 pt-2">
        <Row label="Last reading">{fmt(site.measuredAt)}</Row>
        <Row label="Last delivery">{fmt(site.lastDeliveryAt)}</Row>
        <Row label="Reporting">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: REPORTING[site.reporting].color }} />
            {REPORTING[site.reporting].label}
          </span>
        </Row>
      </dl>

      <dl className="mt-2 border-t border-slate-200 pt-2">
        <Row label="Registered">
          {site.registered.latitude !== null
            ? `${site.registered.latitude.toFixed(6)}, ${site.registered.longitude!.toFixed(6)}`
            : '—'}
        </Row>
        <Row label="Reported">
          {site.reported.latitude !== null
            ? `${site.reported.latitude.toFixed(6)}, ${site.reported.longitude!.toFixed(6)}`
            : '—'}
        </Row>
        <Row label="Distance">{loc.metres === null ? '—' : describeDistance(loc.metres)}</Row>
      </dl>

      <p
        className={`mt-2 rounded px-2 py-1.5 font-medium ${
          loc.status === 'MATCH'
            ? 'bg-emerald-50 text-emerald-900'
            : loc.status === 'MISMATCH'
              ? 'bg-red-50 text-red-900'
              : 'bg-slate-100 text-slate-600'
        }`}
      >
        {locationLine}
      </p>

      {site.lastDeliveredName && (
        <p className="mt-2 break-all font-mono text-[10px] text-slate-400">{site.lastDeliveredName}</p>
      )}
    </div>
  );
}
