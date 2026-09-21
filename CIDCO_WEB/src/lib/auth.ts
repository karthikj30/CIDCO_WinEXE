import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { prisma } from './prisma';
import type { Role, User } from '@prisma/client';

export const SESSION_COOKIE = 'cidco_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  sub: string;
  email: string;
  role: Role;
  name: string;
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function signToken(payload: SessionPayload) {
  return new SignJWT({ email: payload.email, role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('cidco-aqi-portal')
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: 'cidco-aqi-portal' });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role as Role,
      name: String(payload.name ?? ''),
    };
  } catch {
    return null;
  }
}

// The two portals get their own cookie, so a CIDCO officer and an architect can
// be signed in side by side in the same browser without evicting each other.
export const OFFICER_COOKIE = 'cidco_officer_session';
export const ARCHITECT_COOKIE = 'cidco_architect_session';

export type SessionScope = 'OFFICER' | 'ARCHITECT';

export function scopeForRole(role: Role): SessionScope {
  return role === 'ARCHITECT' ? 'ARCHITECT' : 'OFFICER';
}

export function cookieForScope(scope: SessionScope) {
  return scope === 'ARCHITECT' ? ARCHITECT_COOKIE : OFFICER_COOKIE;
}

/**
 * Whether to mark the session cookie `Secure`.
 *
 * This used to be `NODE_ENV === 'production'`, which is the usual shorthand
 * and is wrong the moment a production build is served over plain HTTP. A
 * browser will not store a Secure cookie on an http:// page — and it says
 * nothing while refusing — so signing in appeared to work, the header came
 * back with the cookie on it, and every request after that arrived with no
 * session at all. The portal answered "CIDCO officer sign-in required" on a
 * page that was showing the officer's own name in the sidebar.
 *
 * It follows the actual protocol now. Behind a reverse proxy that is
 * `x-forwarded-proto`; set COOKIE_SECURE=true/false to decide it explicitly.
 *
 * (localhost is exempt from the rule in browsers, which is why this survives
 * every local test and only shows up on a deployed IP.)
 */
async function useSecureCookies(): Promise<boolean> {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;

  const jar = await headers();
  const forwarded = jar.get('x-forwarded-proto') ?? '';
  // A proxy chain can send "https,http"; the client-facing one is first.
  return forwarded.split(',')[0].trim().toLowerCase() === 'https';
}

export async function setSessionCookie(token: string, scope: SessionScope) {
  const jar = await cookies();
  jar.set(cookieForScope(scope), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await useSecureCookies(),
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

/** Clears one portal's session, or both when no scope is given. */
export async function clearSessionCookie(scope?: SessionScope) {
  const jar = await cookies();
  const names = scope ? [cookieForScope(scope)] : [OFFICER_COOKIE, ARCHITECT_COOKIE, SESSION_COOKIE];
  for (const name of names) {
    jar.set(name, '', { httpOnly: true, path: '/', maxAge: 0 });
  }
}

/** Reads the session for server components / pages. */
export async function getSessionUser(scope?: SessionScope): Promise<User | null> {
  const jar = await cookies();
  const names = scope
    ? [cookieForScope(scope)]
    : [OFFICER_COOKIE, ARCHITECT_COOKIE, SESSION_COOKIE];
  for (const name of names) {
    const token = jar.get(name)?.value;
    if (!token) continue;
    const payload = await verifyToken(token);
    if (!payload) continue;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user) return user;
  }
  return null;
}

/** Resolves the signed-in user for one portal from a request's cookies. */
export async function sessionUserFor(req: NextRequest, scope: SessionScope): Promise<User | null> {
  const token = req.cookies.get(cookieForScope(scope))?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return null;
  // A cookie must match the portal it belongs to.
  return scopeForRole(user.role) === scope ? user : null;
}

// ---------------------------------------------------------------------------
// API keys — machine-to-machine auth for the "architect hits the CIDCO API"
// flow. The plaintext key is only ever returned at creation time.
// ---------------------------------------------------------------------------

export const API_KEY_PREFIX = 'cidco_live_';

export function generateApiKey() {
  const raw = randomBytes(24).toString('hex');
  const key = `${API_KEY_PREFIX}${raw}`;
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, 18) };
}

export function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

function readApiKey(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const value = header.slice(7).trim();
    if (value.startsWith(API_KEY_PREFIX)) return value;
  }
  const direct = req.headers.get('x-api-key');
  return direct?.trim() || null;
}

export type AuthedUser = { user: User; via: 'session' | 'api-key' };

/**
 * Resolves the caller from either a browser session cookie, a Bearer JWT
 * (handy from Postman after /api/auth/login) or an API key.
 */
export async function authenticate(req: NextRequest): Promise<AuthedUser | null> {
  const apiKey = readApiKey(req);
  if (apiKey) {
    const record = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(apiKey) },
      include: { user: true },
    });
    if (!record || record.revokedAt) return null;
    await prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return { user: record.user, via: 'api-key' };
  }

  const header = req.headers.get('authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const candidates = [
    bearer,
    req.cookies.get(OFFICER_COOKIE)?.value,
    req.cookies.get(ARCHITECT_COOKIE)?.value,
    req.cookies.get(SESSION_COOKIE)?.value,
  ].filter(Boolean) as string[];

  for (const token of candidates) {
    const payload = await verifyToken(token);
    if (!payload) continue;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user) return { user, via: 'session' };
  }
  return null;
}
