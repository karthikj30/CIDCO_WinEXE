import type { NextRequest } from 'next/server';
import type { User } from '@prisma/client';
import { authenticate, sessionUserFor } from './auth';
import { forbidden, unauthorized } from './api';
import { NextResponse } from 'next/server';

export type GuardResult = { user: User } | { error: NextResponse };

/**
 * Admin-side endpoints (issuing credentials, approving validations, minting
 * tokens, reading the exchange) require a signed-in CIDCO officer.
 *
 * The officer's session is read from its own cookie, so an architect signed in
 * to the other portal in the same browser cannot displace it.
 */
export async function requireCidco(req: NextRequest): Promise<GuardResult> {
  const officer = await sessionUserFor(req, 'OFFICER');
  if (officer) return { user: officer };

  // Fall back to a Bearer JWT / API key (Postman, machine clients).
  const auth = await authenticate(req);
  if (!auth) return { error: unauthorized('CIDCO officer sign-in required.') };
  if (auth.user.role === 'ARCHITECT') {
    return { error: forbidden('This endpoint is for CIDCO officers only.') };
  }
  return { user: auth.user };
}

/**
 * The architect's own portal. Read-only views of their handshakes, tokens and
 * readings — the protocol calls (validate / data) still go through the
 * token-authenticated endpoints, so this is never a back door.
 */
export async function requireArchitect(req: NextRequest): Promise<GuardResult> {
  const architect = await sessionUserFor(req, 'ARCHITECT');
  if (architect) return { user: architect };

  const auth = await authenticate(req);
  if (!auth) return { error: unauthorized('Architect sign-in required.') };
  if (auth.user.role !== 'ARCHITECT') {
    return { error: forbidden('This endpoint is for architects only.') };
  }
  return { user: auth.user };
}
