import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import type {
  ArchitectHandshake,
  CommDirection,
  IntegrationToken,
  Prisma,
} from '@prisma/client';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Credential + token generation
//
// The clientId is the "userid" the admin hands to the architect; the secret is
// the "password". Tokens are separate bearer credentials minted once the
// handshake is established. All three are high-entropy random strings, so a
// SHA-256 hash (same approach as the existing ApiKey model) is the right store
// — we never keep the plaintext of the secret or a token.
// ---------------------------------------------------------------------------

export const CLIENT_ID_PREFIX = 'ARCH-';
export const SECRET_PREFIX = 'hs_sec_';
export const TOKEN_PREFIX = 'cidco_tok_';

export const DEFAULT_TOKEN_TTL_DAYS = 7;

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function hashesEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function generateClientId() {
  return `${CLIENT_ID_PREFIX}${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function generateSecret() {
  const secret = `${SECRET_PREFIX}${randomBytes(24).toString('hex')}`;
  return { secret, secretHash: sha256(secret), secretPrefix: secret.slice(0, 14) };
}

export function generateToken() {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { token, tokenHash: sha256(token), prefix: token.slice(0, 16) };
}

export const REFRESH_TOKEN_PREFIX = 'cidco_ref_';
export const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;

export function generateRefreshToken() {
  const token = `${REFRESH_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { token, tokenHash: sha256(token), prefix: token.slice(0, 16) };
}

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Communication log — the human-readable, timestamped trail both sides audit.
// Never pass secrets in `detail`.
// ---------------------------------------------------------------------------

export type CommEvent =
  | 'HANDSHAKE_ISSUED'
  | 'ARCHITECT_VALIDATED'
  | 'CHANNEL_ESTABLISHED'
  | 'VALIDATION_FAILED'
  | 'TOKEN_REQUESTED'
  | 'TOKEN_GENERATED'
  | 'TOKEN_REQUEST_REJECTED'
  | 'DATA_RECEIVED'
  | 'DATA_REJECTED'
  | 'HANDSHAKE_REVOKED'
  | 'IP_WHITELISTED'
  | 'WHITELIST_RESET'
  | 'TOKEN_POLICY_UPDATED'
  | 'TOKEN_EXPIRY_UPDATED'
  | 'VALIDATION_SUBMITTED'
  | 'VALIDATION_APPROVED'
  | 'VALIDATION_REJECTED'
  | 'TOKENS_DELIVERED'
  | 'ACCOUNT_CREATED'
  // SFTP channel. The server writes SFTP_HANDSHAKE_REQUESTED, SFTP_CONNECTED,
  // SFTP_AUTH_FAILED, SFTP_IP_REFUSED, SFTP_FILE_RECEIVED and
  // SFTP_FILE_REJECTED directly; these are the ones the web app raises.
  | 'SFTP_CREDENTIALS_ISSUED'
  | 'SFTP_HANDSHAKE_APPROVED'
  | 'SFTP_HANDSHAKE_REJECTED'
  // An officer turning one account's access off and on again.
  | 'SFTP_ACCOUNT_REVOKED'
  | 'SFTP_ACCOUNT_GRANTED';

export async function logComm(params: {
  handshakeId: string | null;
  direction: CommDirection;
  event: CommEvent;
  statusCode?: number;
  detail?: string;
  ip?: string | null;
}) {
  try {
    await prisma.communicationLog.create({
      data: {
        handshakeId: params.handshakeId,
        direction: params.direction,
        event: params.event,
        statusCode: params.statusCode ?? null,
        detail: params.detail ?? null,
        ip: params.ip ?? null,
      },
    });
  } catch (error) {
    // Logging must never break the exchange it is describing.
    console.error('[comm-log] failed to record', params.event, error);
  }
}

export function clientIp(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  );
}

// ---------------------------------------------------------------------------
// Handshake + token verification
// ---------------------------------------------------------------------------

/** Marks a handshake EXPIRED in the background if its credential window closed. */
export async function effectiveStatus(h: ArchitectHandshake): Promise<ArchitectHandshake['status']> {
  if (h.status === 'REVOKED') return 'REVOKED';
  if (h.credentialExpiresAt.getTime() < Date.now()) {
    if (h.status !== 'EXPIRED') {
      await prisma.architectHandshake.update({ where: { id: h.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    }
    return 'EXPIRED';
  }
  return h.status;
}

export type CredentialCheck =
  | { ok: true; handshake: ArchitectHandshake }
  | { ok: false; reason: string; handshakeId: string | null };

/**
 * Verifies a clientId + secret pair against a stored handshake. Used both by
 * the architect's validate call and by the admin when minting a token "using
 * its user id and password".
 */
export async function verifyCredentials(clientId: string, secret: string): Promise<CredentialCheck> {
  const handshake = await prisma.architectHandshake.findUnique({ where: { clientId } });
  if (!handshake) return { ok: false, reason: 'Unknown clientId', handshakeId: null };
  // SFTP credentials are for the SFTP server only — they never open the API.
  if (handshake.channel !== 'API') {
    return {
      ok: false,
      reason: 'These are SFTP credentials. Use them with the CIDCO SFTP server, not the API.',
      handshakeId: handshake.id,
    };
  }
  if (handshake.status === 'REVOKED' || handshake.revokedAt) {
    return { ok: false, reason: 'Handshake has been revoked', handshakeId: handshake.id };
  }
  if (handshake.credentialExpiresAt.getTime() < Date.now()) {
    await prisma.architectHandshake.update({ where: { id: handshake.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    return { ok: false, reason: 'Credential has expired', handshakeId: handshake.id };
  }
  if (!hashesEqual(sha256(secret), handshake.secretHash)) {
    return { ok: false, reason: 'Invalid clientSecret', handshakeId: handshake.id };
  }
  return { ok: true, handshake };
}

// Messages the architect's automated feed keys off. Kept as constants so the
// data endpoint, the refresh endpoint and the docs all say the same thing.
export const MSG_ACCESS_EXPIRED =
  'Access token has expired. Please request a new access token using your refresh token (POST /api/architect/refresh).';
export const MSG_BOTH_EXPIRED =
  'Access token and refresh token have both expired. Please request a new access token and refresh token using your user id and password (POST /api/architect/validate).';

/** Why a token was rejected — drives the HTTP status and the guidance message. */
export type TokenFailure =
  | 'MISSING'
  | 'UNKNOWN'
  | 'REVOKED'
  | 'NOT_ESTABLISHED'
  | 'ACCESS_EXPIRED' // CASE 2 — refresh still alive, renew with refresh token
  | 'BOTH_EXPIRED' // CASE 3 — refresh dead, so the pair is dead: re-authenticate
  | 'IP_NOT_WHITELISTED';

export type TokenCheck =
  | { ok: true; token: IntegrationToken; handshake: ArchitectHandshake }
  | { ok: false; reason: string; failure: TokenFailure };

/**
 * True when the token's refresh window has closed. Per the CIDCO protocol a
 * dead refresh token kills the whole pair, whatever the access token's own
 * expiry says (CASE 3).
 */
export function refreshWindowClosed(token: IntegrationToken) {
  return !token.refreshExpiresAt || token.refreshExpiresAt.getTime() < Date.now();
}

/** Reads and validates the Bearer integration token on a data request. */
export async function authenticateToken(req: NextRequest): Promise<TokenCheck> {
  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const raw = bearer || req.headers.get('x-integration-token')?.trim() || '';
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: 'Missing integration token. Send Authorization: Bearer <token>.', failure: 'MISSING' };
  }

  const token = await prisma.integrationToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { handshake: true },
  });
  if (!token) return { ok: false, reason: 'Unknown integration token', failure: 'UNKNOWN' };
  if (token.revokedAt) return { ok: false, reason: 'Integration token was revoked', failure: 'REVOKED' };

  // CASE 3 takes priority: once the refresh token lapses the access token is
  // dead too, no matter what its own expiry says.
  if (refreshWindowClosed(token)) {
    return { ok: false, reason: MSG_BOTH_EXPIRED, failure: 'BOTH_EXPIRED' };
  }
  // CASE 2: access expired but refresh still valid.
  if (token.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: MSG_ACCESS_EXPIRED, failure: 'ACCESS_EXPIRED' };
  }
  if (token.handshake.status !== 'ESTABLISHED') {
    return { ok: false, reason: 'Handshake is not established', failure: 'NOT_ESTABLISHED' };
  }

  const gate = checkWhitelist(token.handshake, clientIp(req));
  if (!gate.ok) return { ok: false, reason: gate.reason, failure: 'IP_NOT_WHITELISTED' };

  await prisma.integrationToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { ok: true, token, handshake: token.handshake };
}

/**
 * Issues a fresh access + refresh pair for a handshake and revokes every token
 * that came before it, so exactly one pair is ever live. This is the single
 * issuance path used by validate, the admin dashboard and request approvals —
 * a token can therefore never exist without its refresh half.
 */
export async function issueTokenPair(params: {
  handshakeId: string;
  accessTtlDays: number;
  refreshTtlDays: number;
  createdById?: string | null;
  fromRequestId?: string | null;
}) {
  const { handshakeId, accessTtlDays, refreshTtlDays, createdById, fromRequestId } = params;
  const now = new Date();
  const access = generateToken();
  const refresh = generateRefreshToken();

  const [, record] = await prisma.$transaction([
    prisma.integrationToken.updateMany({
      where: { handshakeId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.integrationToken.create({
      data: {
        handshakeId,
        tokenHash: access.tokenHash,
        prefix: access.prefix,
        expiresAt: addDays(now, accessTtlDays),
        refreshTokenHash: refresh.tokenHash,
        refreshTokenPrefix: refresh.prefix,
        refreshExpiresAt: addDays(now, refreshTtlDays),
        createdById: createdById ?? null,
        fromRequestId: fromRequestId ?? null,
      },
    }),
  ]);

  return {
    record,
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: record.expiresAt,
    refreshExpiresAt: record.refreshExpiresAt!,
    accessTtlDays,
    refreshTtlDays,
  };
}

/**
 * Places tokens on the architect's dashboard as a message. The plaintext lives
 * here only until the architect acknowledges having saved it.
 */
export async function deliverTokens(params: {
  handshakeId: string;
  kind: 'INITIAL_PAIR' | 'ACCESS_RENEWAL' | 'FULL_REISSUE';
  message: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessPrefix?: string | null;
  refreshPrefix?: string | null;
  accessExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  baseUrl?: string | null;
}) {
  return prisma.tokenDelivery.create({
    data: {
      handshakeId: params.handshakeId,
      kind: params.kind,
      message: params.message,
      accessToken: params.accessToken ?? null,
      refreshToken: params.refreshToken ?? null,
      accessPrefix: params.accessPrefix ?? null,
      refreshPrefix: params.refreshPrefix ?? null,
      accessExpiresAt: params.accessExpiresAt ?? null,
      refreshExpiresAt: params.refreshExpiresAt ?? null,
      endpoints: params.baseUrl ? (architectEndpoints(params.baseUrl) as Prisma.InputJsonValue) : undefined,
    },
  });
}

/**
 * Best-effort lookup of the handshake behind a request, even when its token was
 * rejected — so refusals still land on the right handshake's activity log.
 */
export async function handshakeIdForRequest(req: NextRequest): Promise<string | null> {
  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const raw = bearer || req.headers.get('x-integration-token')?.trim() || '';
  if (!raw) return null;
  const token = await prisma.integrationToken
    .findUnique({ where: { tokenHash: sha256(raw) }, select: { handshakeId: true } })
    .catch(() => null);
  return token?.handshakeId ?? null;
}

// ---------------------------------------------------------------------------
// IP / device whitelist (CASE 1)
// ---------------------------------------------------------------------------

/** Normalises loopback forms so ::1 and 127.0.0.1 are treated as one host. */
export function normaliseIp(ip: string | null | undefined) {
  if (!ip) return null;
  const v = ip.trim();
  if (v === '::1' || v === '::ffff:127.0.0.1') return '127.0.0.1';
  return v.startsWith('::ffff:') ? v.slice(7) : v;
}

export function fingerprintDevice(deviceInfo: string) {
  return sha256(deviceInfo.trim().toLowerCase());
}

/**
 * Enforces the IP whitelist recorded when the architect first validated.
 * A handshake that has never been whitelisted, or has enforcement switched off
 * by the admin, passes through.
 */
export function checkWhitelist(
  handshake: ArchitectHandshake,
  ip: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (!handshake.enforceWhitelist || !handshake.whitelistedIp) return { ok: true };
  const seen = normaliseIp(ip);
  const allowed = normaliseIp(handshake.whitelistedIp);
  if (seen && allowed && seen === allowed) return { ok: true };
  return {
    ok: false,
    reason: `Request came from a non-whitelisted IP (${seen ?? 'unknown'}). This handshake is registered to ${allowed}. Ask CIDCO to reset the whitelist.`,
  };
}

/**
 * Resolves the architect's handshake for read-only endpoints (status, logs).
 * Accepts either the Bearer integration token, or the handshake credentials via
 * x-client-id / x-client-secret headers (or ?clientId=&clientSecret= query) so
 * the architect can inspect the exchange even before a token is issued.
 */
export async function resolveHandshakeForRead(
  req: NextRequest,
): Promise<{ ok: true; handshake: ArchitectHandshake } | { ok: false; reason: string }> {
  const tokenCheck = await authenticateToken(req);
  if (tokenCheck.ok) return { ok: true, handshake: tokenCheck.handshake };

  const url = new URL(req.url);
  const clientId = req.headers.get('x-client-id') || url.searchParams.get('clientId') || '';
  const clientSecret = req.headers.get('x-client-secret') || url.searchParams.get('clientSecret') || '';
  if (clientId && clientSecret) {
    const check = await verifyCredentials(clientId, clientSecret);
    if (check.ok) return { ok: true, handshake: check.handshake };
    return { ok: false, reason: check.reason };
  }
  return { ok: false, reason: 'Provide a Bearer token, or x-client-id and x-client-secret headers.' };
}

/**
 * Every URL the architect needs, sent with the tokens so they can copy the
 * whole set from the one dashboard message.
 */
export function architectEndpoints(baseUrl: string) {
  return {
    sendDataUrl: `${baseUrl}/api/architect/data`,
    requestTokenUrl: `${baseUrl}/api/architect/token-requests`,
    validateUrl: `${baseUrl}/api/architect/validate`,
    logsUrl: `${baseUrl}/api/architect/logs`,
    docsUrl: `${baseUrl}/docs/architect`,
  };
}

/**
 * The credential bundle CIDCO emails to the architect: just the user id, the
 * password and how long it is valid. Endpoint URLs live in the API docs and
 * are repeated in the token delivery once the architect is approved.
 */
export function credentialPayload(params: { handshake: ArchitectHandshake; secret: string }) {
  return {
    clientId: params.handshake.clientId,
    clientSecret: params.secret,
    expiryDate: params.handshake.credentialExpiresAt.toISOString(),
  };
}
