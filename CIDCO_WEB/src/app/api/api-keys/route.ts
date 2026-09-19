import type { NextRequest } from 'next/server';
import { authenticate, generateApiKey } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleError, ok, unauthorized } from '@/lib/api';
import { apiKeySchema } from '@/lib/validation';
import { logAudit } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    });
    return ok({ apiKeys: keys });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/api-keys — issues the credential the architect's system uses to
 * push reports to CIDCO. The plaintext key is returned exactly once.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const { label } = apiKeySchema.parse(await req.json());
    const { key, keyHash, prefix } = generateApiKey();

    const record = await prisma.apiKey.create({
      data: { userId: auth.user.id, label, keyHash, prefix },
      select: { id: true, label: true, prefix: true, createdAt: true },
    });

    await logAudit('apikey.create', { userId: auth.user.id, detail: label });

    return ok(
      {
        message: 'Store this key now — it will not be shown again.',
        apiKey: { ...record, key },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
