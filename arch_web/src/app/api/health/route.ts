import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return ok({ status: 'ok', database: 'connected', time: new Date().toISOString() });
  } catch (error) {
    return fail(`Database unreachable: ${(error as Error).message}`, 503);
  }
}
