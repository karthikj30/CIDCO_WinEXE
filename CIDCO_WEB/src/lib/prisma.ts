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
