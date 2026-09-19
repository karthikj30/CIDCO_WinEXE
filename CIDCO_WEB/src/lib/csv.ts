export const CSV_COLUMNS = [
  'siteName',
  'location',
  'measuredAt',
  'aqiValue',
  'pm25',
  'pm10',
  'so2',
  'no2',
  'co',
  'ozone',
  'latitude',
  'longitude',
  'remarks',
  'projectCode',
] as const;

/** Accepts the friendlier header spellings people actually type in Excel. */
const HEADER_ALIASES: Record<string, string> = {
  site: 'siteName',
  site_name: 'siteName',
  'site name': 'siteName',
  address: 'location',
  date: 'measuredAt',
  measured_at: 'measuredAt',
  'measurement date': 'measuredAt',
  aqi: 'aqiValue',
  aqi_value: 'aqiValue',
  'aqi value': 'aqiValue',
  'pm2.5': 'pm25',
  pm2_5: 'pm25',
  'pm 2.5': 'pm25',
  'pm 10': 'pm10',
  o3: 'ozone',
  lat: 'latitude',
  lng: 'longitude',
  long: 'longitude',
  notes: 'remarks',
  project: 'projectCode',
  project_code: 'projectCode',
};

export function normaliseHeader(header: string) {
  const trimmed = header.trim();
  const lower = trimmed.toLowerCase();
  if (HEADER_ALIASES[lower]) return HEADER_ALIASES[lower];
  const match = CSV_COLUMNS.find((c) => c.toLowerCase() === lower);
  return match ?? trimmed;
}

export const CSV_TEMPLATE = [
  CSV_COLUMNS.join(','),
  'Kharghar Sector 12 Site,"Kharghar, Navi Mumbai",2026-08-01T09:30:00Z,148,62.4,120.5,12.1,33.8,0.8,41.2,19.0330,73.0630,Morning reading,CIDCO-KHR-012',
  'Ulwe Node Plot 45,"Ulwe, Navi Mumbai",2026-08-02T10:00:00Z,96,38.2,80.1,9.4,22.5,0.5,30.4,18.9880,73.0210,Within limits,CIDCO-ULW-045',
].join('\n');
