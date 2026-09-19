import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import { validateHandshakeSchema } from '@/lib/validation';
import { checkWhitelist, clientIp, logComm, normaliseIp, verifyCredentials } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/architect/validate
 *
 * The architect's first API hit, using the user id and password CIDCO emailed
 * them, declaring the IP address and device CIDCO should register.
 *
 * CIDCO does NOT issue tokens here. The credentials are checked, then the
 * attempt is queued on the CIDCO dashboard as a validation request so an
 * officer can see the architect, IP and device and approve it. On approval
 * CIDCO generates the access and refresh tokens and delivers them to the
 * architect's dashboard.
 *
 * Wrong credentials still answer 504 — "handshake not validated".
 */
export async function POST(req: NextRequest) {
  return withLogging(
    req,
    async (req) => {
      try {
        const ip = clientIp(req);
        const { clientId, clientSecret, ipAddress, deviceInfo } = validateHandshakeSchema.parse(
          await req.json(),
        );

        const check = await verifyCredentials(clientId, clientSecret);
        if (!check.ok) {
          await logComm({
            handshakeId: check.handshakeId,
            direction: 'ARCHITECT_TO_ADMIN',
            event: 'VALIDATION_FAILED',
            statusCode: 504,
            detail: `Validation failed for clientId "${clientId}": ${check.reason}`,
            ip,
          });
          return fail(`Validation failed: ${check.reason}`, 504);
        }

        const handshake = check.handshake;
        const presentedIp = normaliseIp(ipAddress) ?? normaliseIp(ip);

        // If CIDCO already registered an IP for this handshake, the caller must
        // match it — otherwise the request never reaches the approval queue.
        const gate = checkWhitelist(handshake, presentedIp);
        if (!gate.ok) {
          await logComm({
            handshakeId: handshake.id,
            direction: 'ARCHITECT_TO_ADMIN',
            event: 'VALIDATION_FAILED',
            statusCode: 504,
            detail: gate.reason,
            ip,
          });
          return fail(`Validation failed: ${gate.reason}`, 504);
        }

        // One open request at a time.
        const existing = await prisma.validationRequest.findFirst({
          where: { handshakeId: handshake.id, status: 'PENDING' },
        });
        if (existing) {
          return ok(
            {
              message:
                'Your request is already with CIDCO and is awaiting approval. You will receive your tokens on your dashboard once an officer approves it.',
              status: 'AWAITING_APPROVAL',
              requestId: existing.id,
              submittedAt: existing.createdAt,
            },
            202,
          );
        }

        const request = await prisma.validationRequest.create({
          data: {
            handshakeId: handshake.id,
            presentedIp,
            deviceInfo: deviceInfo ?? null,
          },
        });

        await prisma.architectHandshake.update({
          where: { id: handshake.id },
          data: {
            status: handshake.status === 'ESTABLISHED' ? 'ESTABLISHED' : 'AWAITING_APPROVAL',
            architectValidatedAt: new Date(),
            lastValidatedIp: ip,
          },
        });

        await logComm({
          handshakeId: handshake.id,
          direction: 'ARCHITECT_TO_ADMIN',
          event: 'VALIDATION_SUBMITTED',
          statusCode: 202,
          detail: `Architect presented credentials from IP ${presentedIp ?? 'unknown'}${deviceInfo ? ` · device: ${deviceInfo}` : ''} — awaiting CIDCO approval`,
          ip,
        });

        return ok(
          {
            message:
              'Credentials accepted and sent to CIDCO for approval. CIDCO will verify your identity, IP address and device, then deliver your access and refresh tokens to your dashboard.',
            status: 'AWAITING_APPROVAL',
            requestId: request.id,
            submittedAt: request.createdAt,
            presentedIp,
            deviceInfo: deviceInfo ?? null,
            nextSteps: [
              'Wait for CIDCO to approve the request.',
              'Your access and refresh tokens will appear on your dashboard once approved.',
            ],
          },
          202,
        );
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false },
  );
}
