import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, signToken, setSessionCookie, scopeForRole } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { handleError, fail, ok } from '@/lib/api';
import { logAudit } from '@/lib/reports';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = registerSchema.parse(body);

    const email = data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return fail('An account with this email already exists', 409);

    const user = await prisma.user.create({
      data: {
        email,
        name: data.name,
        passwordHash: await hashPassword(data.password),
        // Public sign-up makes architects, full stop. The role used to be
        // taken from the request body, so anyone who could reach this endpoint
        // could mint themselves a CIDCO officer with one curl — and an officer
        // reads every company's data and approves submissions. Officers are
        // created on the server, by someone with shell access:
        // `npm run officer:create`.
        role: 'ARCHITECT',
        firmName: data.firmName ?? null,
        councilRegNo: data.councilRegNo ?? null,
        phone: data.phone ?? null,
      },
    });

    const token = await signToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    await setSessionCookie(token, scopeForRole(user.role));
    await logAudit('user.register', { userId: user.id, detail: user.email });

    return ok(
      {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, firmName: user.firmName },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
