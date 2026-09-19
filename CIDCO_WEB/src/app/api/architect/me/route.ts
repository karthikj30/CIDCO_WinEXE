import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireArchitect } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/me
 *
 * Everything the architect's dashboard needs about their own integration:
 * each handshake CIDCO issued them, the live token windows, their recent
 * readings and the exchange log. Session-authenticated and scoped to the
 * signed-in architect — it never returns secrets or plaintext tokens.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireArchitect(req);
    if ('error' in guard) return guard.error;
    const me = guard.user;
    const now = Date.now();

    const handshakes = await prisma.architectHandshake.findMany({
      // The API workspace shows API integrations; SFTP has its own workspace.
      where: { architectId: me.id, channel: 'API' },
      orderBy: { createdAt: 'desc' },
      include: {
        tokens: { orderBy: { createdAt: 'desc' }, take: 5 },
        commLogs: { orderBy: { createdAt: 'desc' }, take: 30 },
        deliveries: { orderBy: { createdAt: 'desc' }, take: 10 },
        validationRequests: { orderBy: { createdAt: 'desc' }, take: 5 },
        tokenRequests: { orderBy: { requestedAt: 'desc' }, take: 5 },
        _count: { select: { tokenRequests: true } },
      },
    });

    const rows = handshakes.map((h) => {
      const live = h.tokens.find(
        (t) =>
          !t.revokedAt &&
          t.expiresAt.getTime() > now &&
          !!t.refreshExpiresAt &&
          t.refreshExpiresAt.getTime() > now,
      );
      const latest = h.tokens[0] ?? null;
      const credentialExpired = h.credentialExpiresAt.getTime() < now;

      return {
        id: h.id,
        clientId: h.clientId,
        secretPrefix: h.secretPrefix,
        status: credentialExpired && h.status !== 'REVOKED' ? 'EXPIRED' : h.status,
        credentialExpiresAt: h.credentialExpiresAt,
        establishedAt: h.establishedAt,
        architectValidatedAt: h.architectValidatedAt,
        whitelistedIp: h.whitelistedIp,
        deviceInfo: h.deviceInfo,
        enforceWhitelist: h.enforceWhitelist,
        accessTokenTtlDays: h.accessTokenTtlDays,
        refreshTokenTtlDays: h.refreshTokenTtlDays,
        pendingTokenRequests: h._count.tokenRequests,
        // Prefixes only — the plaintext is shown once, at generation.
        liveToken: live
          ? {
              prefix: live.prefix,
              refreshPrefix: live.refreshTokenPrefix,
              expiresAt: live.expiresAt,
              refreshExpiresAt: live.refreshExpiresAt,
              lastUsedAt: live.lastUsedAt,
            }
          : null,
        latestToken: latest
          ? {
              prefix: latest.prefix,
              refreshPrefix: latest.refreshTokenPrefix,
              expiresAt: latest.expiresAt,
              refreshExpiresAt: latest.refreshExpiresAt,
              revoked: !!latest.revokedAt,
              accessExpired: latest.expiresAt.getTime() <= now,
              refreshExpired: !latest.refreshExpiresAt || latest.refreshExpiresAt.getTime() <= now,
            }
          : null,
        commLogs: h.commLogs,
        // Messages CIDCO put on this architect's dashboard — the plaintext
        // tokens are present only until the architect acknowledges them.
        deliveries: h.deliveries.map((d) => ({
          id: d.id,
          kind: d.kind,
          message: d.message,
          accessToken: d.accessToken,
          refreshToken: d.refreshToken,
          accessPrefix: d.accessPrefix,
          refreshPrefix: d.refreshPrefix,
          accessExpiresAt: d.accessExpiresAt,
          refreshExpiresAt: d.refreshExpiresAt,
          endpoints: d.endpoints,
          acknowledgedAt: d.acknowledgedAt,
          createdAt: d.createdAt,
        })),
        validationRequests: h.validationRequests.map((v) => ({
          id: v.id,
          status: v.status,
          presentedIp: v.presentedIp,
          deviceInfo: v.deviceInfo,
          reviewNote: v.reviewNote,
          createdAt: v.createdAt,
          reviewedAt: v.reviewedAt,
        })),
        tokenRequests: h.tokenRequests.map((t) => ({
          id: t.id,
          status: t.status,
          kind: t.kind,
          reason: t.reason,
          requestedAt: t.requestedAt,
          resolvedAt: t.resolvedAt,
        })),
      };
    });

    const [readingCount, recentReadings] = await Promise.all([
      prisma.report.count({ where: { userId: me.id } }),
      prisma.report.findMany({
        where: { userId: me.id },
        orderBy: { receivedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          referenceNo: true,
          projectSiteId: true,
          monitoringStationId: true,
          siteName: true,
          measuredAt: true,
          aqiValue: true,
          pm25: true,
          pm10: true,
          temperature: true,
          humidity: true,
          source: true,
          status: true,
          receivedAt: true,
        },
      }),
    ]);

    return ok({
      architect: {
        id: me.id,
        name: me.name,
        email: me.email,
        firmName: me.firmName,
        councilRegNo: me.councilRegNo,
      },
      handshakes: rows,
      readingCount,
      recentReadings,
    });
  } catch (error) {
    return handleError(error);
  }
}
