import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scopeForRole, setSessionCookie, signToken, verifyPassword } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { fail, handleError, ok } from '@/lib/api';
import { logAudit } from '@/lib/reports';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail('Invalid email or password', 401);
    }

    const token = await signToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    await setSessionCookie(token, scopeForRole(user.role));
    await logAudit('user.login', { userId: user.id, detail: user.email });

    return ok({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, firmName: user.firmName },
    });
  } catch (error) {
    return handleError(error);
  }
}
