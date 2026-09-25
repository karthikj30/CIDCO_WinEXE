/**
 * The AQI scale, as CPCB publishes it, and the things the dashboard derives
 * from a reading: which band it falls in, whether a site is still reporting,
 * and how far a delivery came from where the site was registered.
 *
 * All of it lives here rather than in the components so the API and the
 * charts cannot disagree about what "Poor" means.
 */

/** CPCB's six bands. `upTo` is inclusive; Severe has no upper bound. */
export const AQI_BANDS = [
  { key: 'GOOD', label: 'Good', upTo: 50 },
  { key: 'SATISFACTORY', label: 'Satisfactory', upTo: 100 },
  { key: 'MODERATE', label: 'Moderate', upTo: 200 },
  { key: 'POOR', label: 'Poor', upTo: 300 },
  { key: 'VERY_POOR', label: 'Very poor', upTo: 400 },
  { key: 'SEVERE', label: 'Severe', upTo: Infinity },
] as const;

export type AqiBandKey = (typeof AQI_BANDS)[number]['key'];

/**
 * Severity is ordered, so it is drawn as one hue light to dark rather than
 * six different ones.
 *
 * CPCB's own colours run green-yellow-orange-red, and those neighbours cannot
 * be told apart by a red-green colourblind reader — nor, at CPCB's yellow, by
 * anyone, since it measures 1.12:1 against white and is effectively invisible.
 * This ramp is validated: monotone lightness, one hue, every step clear of the
 * surface. The band name is written beside every use of it, so the colour
 * never carries the meaning by itself.
 */
export const BAND_COLOR: Record<AqiBandKey, string> = {
  GOOD: '#EDA669',
  SATISFACTORY: '#E28C3E',
  MODERATE: '#D0730F',
  POOR: '#AE5A0C',
  VERY_POOR: '#8B4409',
  SEVERE: '#5F2B05',
};

/**
 * The same bands where the colour is reporting a state rather than inviting a
 * comparison — a marker on the map, a badge beside a number.
 *
 * Here the familiar green-to-red progression is right: an officer reads a
 * green dot as "fine" without thinking, and a light-orange one for "Good"
 * would say the opposite. Every step clears 3:1 against a white surface, so
 * each marker is visible.
 *
 * What it cannot do is separate adjacent bands by colour: green through red in
 * six steps puts Good beside Satisfactory at ΔE 1.0 under protanopia, and no
 * choice of steps fixes that while keeping the progression. So the band name
 * is written next to every use of these — the map tooltip, the detail panel,
 * the legend and the table column all name it — and the colour is never the
 * only thing saying which band a site is in.
 */
export const BAND_STATUS_COLOR: Record<AqiBandKey, string> = {
  GOOD: '#0a7d0a',
  SATISFACTORY: '#4f7d1a',
  MODERATE: '#9c6b00',
  POOR: '#c2571f',
  VERY_POOR: '#c02a2a',
  SEVERE: '#7d1d1d',
};

export function bandOf(aqi: number | null | undefined): AqiBandKey | null {
  if (aqi === null || aqi === undefined || !Number.isFinite(aqi)) return null;
  return (AQI_BANDS.find((b) => aqi <= b.upTo) ?? AQI_BANDS[AQI_BANDS.length - 1]).key;
}

export function bandLabel(key: AqiBandKey | null): string {
  return AQI_BANDS.find((b) => b.key === key)?.label ?? '—';
}

/**
 * The pollutants a reading carries, in the order CIDCO lists them.
 *
 * Colours are the first six categorical slots in their documented order,
 * which is what makes adjacent pairs separable; they are never reordered to
 * suit a filter, so a pollutant keeps its colour however many are on screen.
 */
export const POLLUTANTS = [
  { key: 'pm25', label: 'PM2.5', color: '#2a78d6' },
  { key: 'pm10', label: 'PM10', color: '#eb6834' },
  { key: 'no2', label: 'NO₂', color: '#1baf7a' },
  { key: 'so2', label: 'SO₂', color: '#eda100' },
  { key: 'co', label: 'CO', color: '#e87ba4' },
  { key: 'ozone', label: 'O₃', color: '#008300' },
] as const;

export type PollutantKey = (typeof POLLUTANTS)[number]['key'];

/** Overall AQI is its own series, drawn alone, so it takes slot 1. */
export const AQI_COLOR = '#2a78d6';

/**
 * How a site is doing at getting data to CIDCO.
 *
 * Thresholds are in hours since the last delivery. An agent on CIDCO's own
 * three-hour default that has said nothing for six is late enough to notice
 * and not so late that a single missed run raises an alarm.
 */
export const REPORTING = {
  NORMAL: { key: 'NORMAL', label: 'Reporting', color: '#0ca30c' },
  DELAYED: { key: 'DELAYED', label: 'Delayed', color: '#fab219' },
  SILENT: { key: 'SILENT', label: 'Not reporting', color: '#d03b3b' },
  NEVER: { key: 'NEVER', label: 'Never reported', color: '#898781' },
} as const;

export type ReportingKey = keyof typeof REPORTING;

export function reportingStatus(lastDeliveryAt: Date | string | null, now = new Date()): ReportingKey {
  if (!lastDeliveryAt) return 'NEVER';
  const hours = (now.getTime() - new Date(lastDeliveryAt).getTime()) / 3_600_000;
  if (hours <= 6) return 'NORMAL';
  if (hours <= 24) return 'DELAYED';
  return 'SILENT';
}

/**
 * Metres between two positions on the earth's surface.
 *
 * The haversine formula, which treats the earth as a sphere. Over the
 * distances this is used for — a delivery against the site it was registered
 * at — the error from ignoring the flattening is centimetres.
 */
export function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How the map words a distance: metres up close, kilometres once that stops helping. */
export function describeDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** Where CIDCO registered the site, against where the data actually came from. */
export type LocationCheck = {
  status: 'MATCH' | 'MISMATCH' | 'NO_REGISTERED' | 'NO_REPORTED';
  metres: number | null;
  withinRadius: boolean | null;
};

export function checkLocation(
  registered: { latitude: number | null; longitude: number | null; radiusMetres: number },
  reported: { latitude: number | null; longitude: number | null },
): LocationCheck {
  if (registered.latitude === null || registered.longitude === null) {
    return { status: 'NO_REGISTERED', metres: null, withinRadius: null };
  }
  if (reported.latitude === null || reported.longitude === null) {
    return { status: 'NO_REPORTED', metres: null, withinRadius: null };
  }
  const metres = metresBetween(
    registered.latitude, registered.longitude,
    reported.latitude, reported.longitude,
  );
  const within = metres <= registered.radiusMetres;
  return { status: within ? 'MATCH' : 'MISMATCH', metres, withinRadius: within };
}

/** The default permitted radius, in metres, when a site does not set its own. */
export const DEFAULT_RADIUS_METRES = 500;
