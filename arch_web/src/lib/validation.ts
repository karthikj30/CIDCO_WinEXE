import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firmName: z.string().optional().nullable(),
  councilRegNo: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  // No `role` here on purpose: public sign-up always creates an architect.
  // See the register route.
});

export const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

/** Coerces the loose strings that arrive in multipart form-data / CSV rows. */
const numberish = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : v.trim()))
  .refine((v) => v !== '' && !Number.isNaN(Number(v)), 'Must be a number')
  .transform((v) => Number(v));

const optionalNumberish = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = typeof v === 'number' ? v : v.trim();
    if (s === '') return null;
    return Number(s);
  })
  .refine((v) => v === null || !Number.isNaN(v), 'Must be a number');

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const s = (v ?? '').toString().trim();
    return s === '' ? null : s;
  });

// "Other applicable environmental parameters" — a free-form bag accepted as an
// object or a JSON string.
const otherParamsSchema = z
  .union([z.record(z.any()), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as Record<string, unknown>;
      } catch {
        return { note: v };
      }
    }
    return v as Record<string, unknown>;
  });

export const reportSchema = z.object({
  siteName: z.string().min(2, 'Site name is required'),
  location: z.string().min(2, 'Location is required'),
  measuredAt: z
    .union([z.string(), z.date()])
    .transform((v) => (v instanceof Date ? v : new Date(v)))
    .refine((d) => !Number.isNaN(d.getTime()), 'measuredAt must be a valid ISO date'),
  aqiValue: numberish.refine((n) => n >= 0 && n <= 1000, 'aqiValue must be between 0 and 1000').transform((n) => Math.round(n)),
  latitude: optionalNumberish.refine((v) => v === null || (v >= -90 && v <= 90), 'latitude must be between -90 and 90'),
  longitude: optionalNumberish.refine((v) => v === null || (v >= -180 && v <= 180), 'longitude must be between -180 and 180'),
  pm25: optionalNumberish,
  pm10: optionalNumberish,
  so2: optionalNumberish,
  no2: optionalNumberish,
  co: optionalNumberish,
  ozone: optionalNumberish,
  remarks: optionalText,
  projectCode: optionalText,

  // Station / device provenance for automated AQI monitoring feeds.
  projectSiteId: optionalText,
  monitoringStationId: optionalText,
  oem: optionalText,
  deviceModel: optionalText,
  temperature: optionalNumberish,
  humidity: optionalNumberish,
  integrationMethod: optionalText,
  otherParams: otherParamsSchema,
});

export type ReportInput = z.infer<typeof reportSchema>;

// ---------------------------------------------------------------------------
// Header/key aliasing — lets a device or an integrator send the human-readable
// parameter names (e.g. "PM2.5", "O₃", "Station/Device ID", "Data Source /
// Integration Method") and still land on the canonical schema keys.
// ---------------------------------------------------------------------------

function normaliseKey(key: string) {
  return key.toLowerCase().replace(/₂/g, '2').replace(/₃/g, '3').replace(/[^a-z0-9]/g, '');
}

const READING_ALIASES: Record<string, keyof ReportInput> = {
  sitename: 'siteName',
  location: 'location',
  address: 'location',
  latitude: 'latitude',
  lat: 'latitude',
  longitude: 'longitude',
  lng: 'longitude',
  long: 'longitude',
  remarks: 'remarks',
  notes: 'remarks',
  projectcode: 'projectCode',
  // date & time of reading
  measuredat: 'measuredAt',
  datetimeofreading: 'measuredAt',
  dateandtimeofreading: 'measuredAt',
  readingtime: 'measuredAt',
  readingdatetime: 'measuredAt',
  datetime: 'measuredAt',
  timestamp: 'measuredAt',
  // pollutants
  aqivalue: 'aqiValue',
  aqi: 'aqiValue',
  pm25: 'pm25',
  pm10: 'pm10',
  no2: 'no2',
  so2: 'so2',
  co: 'co',
  o3: 'ozone',
  ozone: 'ozone',
  // environment
  temperature: 'temperature',
  temp: 'temperature',
  humidity: 'humidity',
  rh: 'humidity',
  // provenance
  projectsiteid: 'projectSiteId',
  siteid: 'projectSiteId',
  projectid: 'projectSiteId',
  aqimonitoringstationdeviceid: 'monitoringStationId',
  monitoringstationid: 'monitoringStationId',
  monitoringstationdeviceid: 'monitoringStationId',
  stationid: 'monitoringStationId',
  deviceid: 'monitoringStationId',
  stationdeviceid: 'monitoringStationId',
  oem: 'oem',
  manufacturer: 'oem',
  model: 'deviceModel',
  devicemodel: 'deviceModel',
  datasourceintegrationmethod: 'integrationMethod',
  integrationmethod: 'integrationMethod',
  datasource: 'integrationMethod',
  otherapplicableenvironmentalparameters: 'otherParams',
  otherenvironmentalparameters: 'otherParams',
  environmentalparameters: 'otherParams',
  otherparameters: 'otherParams',
  otherparams: 'otherParams',
};

/**
 * Maps arbitrary incoming keys onto the canonical reading fields. Unknown keys
 * are dropped (the schema ignores them anyway). "Data Receipt Timestamp" is
 * intentionally not mapped — the server always stamps it.
 */
export function normaliseReadingFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const canonical = READING_ALIASES[normaliseKey(key)] ?? key;
    // Don't let an alias clobber a value already set under the canonical name.
    if (out[canonical] === undefined) out[canonical] = value;
  }
  return out;
}

export const reviewSchema = z.object({
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  reviewNote: z.string().optional().nullable(),
});

export const apiKeySchema = z.object({
  label: z.string().min(2, 'Label is required').max(60),
});

// --- Handshake / token flow ------------------------------------------------

export const createHandshakeSchema = z
  .object({
    architectId: z.string().optional(),
    architectEmail: z.string().email().optional(),
    // Credential validity window set by the admin. Either an explicit date or a
    // number of days from now; defaults to 30 days when neither is given.
    expiryDate: z
      .union([z.string(), z.date()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v instanceof Date ? v : new Date(v)))
      .refine((d) => d === undefined || !Number.isNaN(d.getTime()), 'expiryDate must be a valid date'),
    expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
    note: z.string().max(200).optional(),
  })
  .refine((v) => v.architectId || v.architectEmail, {
    message: 'Provide architectId or architectEmail',
    path: ['architectEmail'],
  });

export const validateHandshakeSchema = z.object({
  clientId: z.string().min(3, 'clientId is required'),
  clientSecret: z.string().min(3, 'clientSecret is required'),
  // The architect declares the IP and device CIDCO should whitelist (CASE 1).
  // Both optional: the socket IP is used when ipAddress is omitted.
  ipAddress: z.string().max(64).optional(),
  deviceInfo: z.string().max(300).optional(),
});

/** Admin edits the token expiry policy for a handshake from the dashboard. */
export const tokenPolicySchema = z.object({
  accessTokenTtlDays: z.coerce.number().int().positive().max(365).optional(),
  refreshTokenTtlDays: z.coerce.number().int().positive().max(730).optional(),
  enforceWhitelist: z.boolean().optional(),
});

/** Admin sets an explicit expiry date on the live token pair. */
export const tokenExpirySchema = z.object({
  accessExpiresAt: z
    .union([z.string(), z.date()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v instanceof Date ? v : new Date(v)))
    .refine((d) => d === undefined || !Number.isNaN(d.getTime()), 'accessExpiresAt must be a valid date'),
  refreshExpiresAt: z
    .union([z.string(), z.date()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v instanceof Date ? v : new Date(v)))
    .refine((d) => d === undefined || !Number.isNaN(d.getTime()), 'refreshExpiresAt must be a valid date'),
});

export const tokenRequestSchema = z.object({
  clientId: z.string().min(3, 'clientId is required'),
  clientSecret: z.string().min(3, 'clientSecret is required'),
  reason: z.string().max(300).optional(),
});

export const generateTokenSchema = z.object({
  // The admin mints the token "using its user id and password" — the handshake
  // credential pair must be supplied and must match.
  clientId: z.string().min(3, 'clientId is required'),
  clientSecret: z.string().min(3, 'clientSecret is required'),
  expiresInDays: z.coerce.number().int().positive().max(365).optional(),
  refreshExpiresInDays: z.coerce.number().int().positive().max(730).optional(),
  // Which token(s) CIDCO wants to generate:
  //   both    — a fresh pair, revoking the previous one (default)
  //   access  — new access token only, keeping the current refresh token
  //   refresh — new refresh token only, keeping the current access token
  mode: z.enum(['both', 'access', 'refresh']).optional(),
});

export const approveRequestSchema = z.object({
  expiresInDays: z.coerce.number().int().positive().max(365).optional(),
});
