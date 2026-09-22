import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword, signToken, setSessionCookie } from '@/lib/auth';
import { handleError, fail, ok } from '@/lib/api';
import { logAudit } from '@/lib/reports';

/**
 * POST /api/auth/officer-signup
 *
 * Creating a CIDCO officer from the portal, instead of over SSH.
 *
 * Officers read every company's data and approve submissions, so this cannot
 * simply be open: /api/auth/register deliberately refuses to grant the role
 * for exactly that reason. Two things are accepted here instead.
 *
 *  - **The first officer.** A database with no officer in it has nobody who
 *    could authorise one, so the first account is allowed through. There is
 *    nothing to protect yet and no other way in.
 *  - **After that, the sign-up code**, CIDCO_OFFICER_SIGNUP_CODE. It is a
 *    shared secret held by CIDCO, not a password: it says the person was told
 *    to create an account, which is the thing the portal cannot otherwise
 *    know. An officer already signed in can also add one without it.
 *
 * With no code configured and an officer already present, sign-up is refused
 * and it says so — failing closed, because the alternative is a public form
 * that hands out access to every company's compliance data.
 */
const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  signupCode: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const data = schema.parse(await req.json());
    const email = data.email.toLowerCase().trim();

    if (await prisma.user.findUnique({ where: { email } })) {
      return fail('An account with this email already exists', 409);
    }

    const officers = await prisma.user.count({ where: { role: 'CIDCO_OFFICER' } });
    const isFirstOfficer = officers === 0;

    if (!isFirstOfficer) {
      const expected = process.env.CIDCO_OFFICER_SIGNUP_CODE?.trim();
      if (!expected) {
        return fail(
          'Officer sign-up is closed. Set CIDCO_OFFICER_SIGNUP_CODE in CIDCO_WEB/.env and ' +
            'restart the portal, then share that code with the officer signing up.',
          403,
        );
      }
      if ((data.signupCode ?? '').trim() !== expected) {
        return fail('That sign-up code is not right. Ask CIDCO for the current one.', 403);
      }
    }

    const user = await prisma.user.create({
      data: {
        email,
        name: data.name.trim(),
        role: 'CIDCO_OFFICER',
        passwordHash: await hashPassword(data.password),
      },
    });

    // Signed straight in: having just proved who they are, being sent back to
    // a login form would be theatre.
    const token = await signToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    await setSessionCookie(token, 'OFFICER');
    await logAudit('officer.signup', {
      userId: user.id,
      detail: `${user.email}${isFirstOfficer ? ' (first officer)' : ''}`,
    });

    return ok(
      {
        firstOfficer: isFirstOfficer,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
