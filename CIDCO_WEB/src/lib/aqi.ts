/** CPCB National AQI bands, used for badges and dashboard summaries. */
export type AqiBand = {
  label: string;
  min: number;
  max: number;
  className: string;
  advisory: string;
};

export const AQI_BANDS: AqiBand[] = [
  { label: 'Good', min: 0, max: 50, className: 'bg-emerald-100 text-emerald-800 border-emerald-200', advisory: 'Minimal impact' },
  { label: 'Satisfactory', min: 51, max: 100, className: 'bg-lime-100 text-lime-800 border-lime-200', advisory: 'Minor breathing discomfort to sensitive people' },
  { label: 'Moderate', min: 101, max: 200, className: 'bg-amber-100 text-amber-800 border-amber-200', advisory: 'Breathing discomfort to people with lung disease' },
  { label: 'Poor', min: 201, max: 300, className: 'bg-orange-100 text-orange-800 border-orange-200', advisory: 'Breathing discomfort on prolonged exposure' },
  { label: 'Very Poor', min: 301, max: 400, className: 'bg-red-100 text-red-800 border-red-200', advisory: 'Respiratory illness on prolonged exposure' },
  { label: 'Severe', min: 401, max: 10000, className: 'bg-rose-200 text-rose-900 border-rose-300', advisory: 'Affects healthy people; serious impact on those with existing disease' },
];

export function bandFor(aqi: number): AqiBand {
  return AQI_BANDS.find((b) => aqi >= b.min && aqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

export const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: 'bg-slate-100 text-slate-700 border-slate-200',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800 border-blue-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
};
