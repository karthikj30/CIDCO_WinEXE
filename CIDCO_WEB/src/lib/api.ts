import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  databaseUrlMissing,
  missingPrismaModels,
  NO_DATABASE_URL_MESSAGE,
  STALE_CLIENT_MESSAGE,
} from './prisma';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error: message, details }, { status });
}

export function unauthorized(message = 'Authentication required. Send a session cookie, Bearer JWT or X-API-Key header.') {
  return fail(message, 401);
}

export function forbidden(message = 'You do not have permission to perform this action.') {
  return fail(message, 403);
}

/**
 * A query that blew up because the generated client predates the schema. Both
 * shapes are worth catching: a missing model reads as `undefined`, and a model
 * that exists but lacks a new field throws "Unknown field/argument".
 */
function isStaleClientError(error: unknown) {
  if (missingPrismaModels.length > 0) return true;
  const message = error instanceof Error ? error.message : '';
  return (
    /Unknown (field|argument|arg)\b/.test(message) ||
    /Cannot read properties of undefined \(reading '(find|create|update|delete|upsert|count)/.test(message)
  );
}

/**
 * Prisma's own complaint when the variable is absent. Worth matching as well
 * as checking process.env, because the variable can be present-but-empty, and
 * because Prisma resolves it from schema.prisma rather than from us.
 */
function isMissingDatabaseUrlError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /Environment variable not found: DATABASE_URL/.test(message);
}

/** Turns thrown errors into a predictable JSON envelope. */
export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return fail('Validation failed', 422, error.flatten().fieldErrors);
  }
  console.error('[api]', error);

  // Checked before the stale-client case: with no DATABASE_URL every query
  // fails, and "regenerate your client" would send you after the wrong thing.
  if (databaseUrlMissing || isMissingDatabaseUrlError(error)) {
    return fail(NO_DATABASE_URL_MESSAGE, 500, { databaseUrlMissing: true });
  }

  if (isStaleClientError(error)) {
    return fail(STALE_CLIENT_MESSAGE, 500, { stalePrismaClient: true });
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  return fail(message, 500);
}
