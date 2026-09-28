import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { hashPassword, setSessionCookie, signToken } from '@/lib/auth';
import { clientIp, logComm, verifyCredentials } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

const schema = z.object({
  clientId: z.string().min(3),
  clientSecret: z.string().min(3),
  email: z.string().email('A valid username (email) is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name is required'),
  firmName: z.string().max(120).optional(),
  councilRegNo: z.string().max(60).optional(),
  phone: z.string().max(40).optional(),
  designation: z.string().max(80).optional(),
  address: z.string().max(300).optional(),
});

/**
 * POST /api/architect/register
 *
 * After CIDCO approves their validation, the architect sets up their own
 * portal login and fills in their details. Proof of ownership is the
 * CIDCO-issued user id and password, so no session is needed here. The details
 * they enter are what CIDCO sees against this architect.
 */
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());

    const check = await verifyCredentials(body.clientId, body.clientSecret);
    if (!check.ok) return fail(`Validation failed: ${check.reason}`, 504);
    if (check.handshake.status !== 'ESTABLISHED') {
      return fail(
        'CIDCO has not approved your validation yet. You can set up your login once it is approved.',
        409,
      );
    }

    const architectId = check.handshake.architectId;
    const email = body.email.toLowerCase();

    // The chosen username must not collide with another account.
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== architectId) {
      return fail('That username is already taken. Please choose another.', 409);
    }

    const user = await prisma.user.update({
      where: { id: architectId },
      data: {
        email,
        passwordHash: await hashPassword(body.password),
        name: body.name,
        firmName: body.firmName ?? null,
        councilRegNo: body.councilRegNo ?? null,
        phone: body.phone ?? null,
        designation: body.designation ?? null,
        address: body.address ?? null,
        accountSetupAt: new Date(),
      },
    });

    await logComm({
      handshakeId: check.handshake.id,
      direction: 'ARCHITECT_TO_ADMIN',
      event: 'ACCOUNT_CREATED',
      statusCode: 201,
      detail: `Architect set up their portal login (${user.email})${body.firmName ? ` · ${body.firmName}` : ''}`,
      ip: clientIp(req),
    });

    // Sign them straight into the architect portal.
    const token = await signToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    await setSessionCookie(token, 'ARCHITECT');

    return ok(
      {
        message: 'Your account is set up. You are signed in — your tokens are on the Messages tab.',
        user: { id: user.id, name: user.name, email: user.email, firmName: user.firmName },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
