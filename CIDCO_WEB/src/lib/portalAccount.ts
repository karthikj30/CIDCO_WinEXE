import type { User } from '@prisma/client';
import { prisma } from './prisma';
import { hashPassword } from './auth';

/**
 * The one portal login CIDCO hands to every architect.
 *
 * Architects do not get an account each. They sign in here, then identify their
 * company with the SFTP user id and password CIDCO issued them — that pair is
 * the per-site nameentity, and it is what every transfer is validated against.
 *
 * It also owns the rows the SFTP channel writes, since an SFTP reading belongs
 * to a registered company rather than to a person; `Report.companyRecordId`
 * carries that attribution.
 */
export const SHARED_ARCHITECT_EMAIL = process.env.ARCHITECT_PORTAL_EMAIL || 'cidco@gmail.com';
/** Shared portal + SFTP password — same value for every architect company. */
export const SHARED_ARCHITECT_PASSWORD = process.env.ARCHITECT_PORTAL_PASSWORD || '123456';

let cachedId: string | null = null;

/** Finds the shared login, creating it if the database was never seeded. */
export async function sharedArchitectAccount(): Promise<User> {
  if (cachedId) {
    const cached = await prisma.user.findUnique({ where: { id: cachedId } });
    if (cached) return cached;
    cachedId = null;
  }

  const existing = await prisma.user.findUnique({ where: { email: SHARED_ARCHITECT_EMAIL } });
  if (existing) {
    cachedId = existing.id;
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      email: SHARED_ARCHITECT_EMAIL,
      name: 'CIDCO Architect Access',
      passwordHash: await hashPassword(SHARED_ARCHITECT_PASSWORD),
      role: 'ARCHITECT',
    },
  });
  cachedId = created.id;
  return created;
}
