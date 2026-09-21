import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * The generated client is built from schema.prisma by `prisma generate` and is
 * not in git. Pull a schema change without regenerating and queries fail with
 * something unhelpful — "Cannot read properties of undefined", or an
 * unknown-field error deep inside a query.
 *
 * This spots that and lets the API answer with a message that says what to do.
 * It deliberately does NOT throw at import time: a module-level throw takes out
 * every route at once, and Next then serves an HTML error page where the
 * browser expects JSON.
 */
const REQUIRED_MODELS = ['user', 'company', 'architectHandshake', 'sftpUpload', 'report'] as const;

export const missingPrismaModels = REQUIRED_MODELS.filter(
  (model) => typeof (prisma as unknown as Record<string, unknown>)[model] !== 'object',
);

export const STALE_CLIENT_MESSAGE =
  `Your generated Prisma client is out of date — it is missing: ${missingPrismaModels.join(', ')}. ` +
  'Stop the server, run `npx prisma generate` (and `npx prisma migrate deploy` if there are new ' +
  'migrations), then start it again.';

if (missingPrismaModels.length > 0) {
  // Loud in the terminal, but the process stays up so the API can explain it.
  console.error(`[prisma] ${STALE_CLIENT_MESSAGE}`);
}

/**
 * No DATABASE_URL.
 *
 * Prisma's own words for this are "Invalid `prisma.user.findUnique()`
 * invocation: error: Environment variable not found: DATABASE_URL -->
 * schema.prisma:7", which lands in front of whoever is trying to sign in and
 * says nothing about what to do. It is nearly always one thing: the app was
 * started somewhere the .env never reached — a fresh clone, a Codespace, or a
 * container run without the variable passed in.
 *
 * Checked here and answered in plain words by the API, for the same reason as
 * the stale-client case above: not thrown at import, so one missing variable
 * does not take out every route and turn JSON responses into HTML error pages.
 */
export const databaseUrlMissing = !process.env.DATABASE_URL?.trim();

export const NO_DATABASE_URL_MESSAGE =
  'DATABASE_URL is not set, so the server cannot reach the database. ' +
  'Copy CIDCO_WEB/.env.example to CIDCO_WEB/.env (or pass DATABASE_URL in the ' +
  'environment), then restart. In Docker, pass it to the container \u2014 a .env ' +
  'file on the host is not read inside one.';

if (databaseUrlMissing) {
  console.error(`[prisma] ${NO_DATABASE_URL_MESSAGE}`);
}
