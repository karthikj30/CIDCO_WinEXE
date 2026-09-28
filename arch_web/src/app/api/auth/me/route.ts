import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleError, ok, unauthorized } from '@/lib/api';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    const { user, via } = auth;
    return ok({
      authenticatedVia: via,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        firmName: user.firmName,
        councilRegNo: user.councilRegNo,
        phone: user.phone,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
