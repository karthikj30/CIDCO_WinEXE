import type { NextRequest } from 'next/server';
import { clearSessionCookie, type SessionScope } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 *
 * Signs out of one portal. `?scope=OFFICER` or `?scope=ARCHITECT` clears just
 * that session, so signing out of one portal leaves the other logged in.
 */
export async function POST(req: NextRequest) {
  try {
    const raw = new URL(req.url).searchParams.get('scope');
    const scope = raw === 'OFFICER' || raw === 'ARCHITECT' ? (raw as SessionScope) : undefined;
    await clearSessionCookie(scope);
    return ok({ message: 'Signed out' });
  } catch (error) {
    return handleError(error);
  }
}
