import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { normalisePath } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

const companySchema = z.object({
  siteName: z
    .string()
    .min(2, 'Site name is required')
    .max(120)
    // It travels in a file name and becomes a folder, so it has to survive
    // both: no slashes, no colons, nothing a path separator could eat.
    .regex(
      /^[A-Za-z0-9 ._-]+$/,
      'Site name may use letters, digits, spaces, dot, dash and underscore',
    ),
  /** Where the agent delivers to. Optional; poll1 files by the name anyway. */
  designatedPath: z.string().max(400).optional().default(''),
  publicKey: z.string().max(4000).optional(),
  privateKey: z.string().max(4000).optional(),
  // Where CIDCO says the site is; the map checks deliveries against it.
  registeredLatitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  registeredLongitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  permittedRadiusMetres: z.coerce.number().int().min(10).max(50_000).optional(),
  userId: z.string().max(160).optional(),
  mobile: z.string().max(40).optional(),
  email: z.string().email('A valid email is required').optional().or(z.literal('')),
  address: z.string().max(400).optional(),
  architectName: z.string().max(160).optional(),
  departmentId: z.string().optional().or(z.literal('')),
  nodeId: z.string().optional().or(z.literal('')),
  notes: z.string().max(300).optional(),
});

/**
 * GET /api/admin/sftp/companies
 *
 * The register CIDCO builds by hand. Every SFTP transfer is validated against
 * one of these rows.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        handshakes: {
          where: { channel: 'SFTP' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            clientId: true,
            status: true,
            credentialExpiresAt: true,
            _count: { select: { sftpUploads: true } },
          },
        },
        department: true,
        node: true,
      },
    });

    return ok({
      companies: companies.map((c) => ({
        id: c.id,
        siteName: c.siteName,
        designatedPath: c.designatedPath,
        publicKey: c.publicKey,
        privateKey: c.privateKey ? '••••••••' : null,
        registeredLatitude: c.registeredLatitude,
        registeredLongitude: c.registeredLongitude,
        permittedRadiusMetres: c.permittedRadiusMetres,
        userId: c.userId,
        mobile: c.mobile,
        email: c.email,
        address: c.address,
        architectName: c.architectName,
        department: c.department ? { id: c.department.id, name: c.department.name } : null,
        node: c.node ? { id: c.node.id, name: c.node.name } : null,
        notes: c.notes,
        active: c.active,
        createdAt: c.createdAt,
        // Credentials issued against this registration, if any yet.
        credentials: c.handshakes.map((h) => ({
          id: h.id,
          username: h.clientId,
          status: h.status,
          credentialExpiresAt: h.credentialExpiresAt,
          uploadCount: h._count.sftpUploads,
        })),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/admin/sftp/companies
 *
 * Step one of the SFTP channel, done by hand by a CIDCO officer before any
 * credentials exist: register the company name, the site name, the
 * and the file path their CSV is taken from.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const data = companySchema.parse(await req.json());

    const existing = await prisma.company.findUnique({ where: { siteName: data.siteName } });
    if (existing) return fail(`Site name "${data.siteName}" is already registered`, 409);

    const company = await prisma.company.create({
      data: {
        siteName: data.siteName.trim(),
        // Stored normalised so a trailing slash or an IPv6-mapped form cannot
        // make a legitimate transfer fail validation later.
        designatedPath: normalisePath(data.designatedPath || ''),
        publicKey: data.publicKey?.trim() || null,
        privateKey: data.privateKey?.trim() || null,
        registeredLatitude: data.registeredLatitude ?? null,
        registeredLongitude: data.registeredLongitude ?? null,
        ...(data.permittedRadiusMetres ? { permittedRadiusMetres: data.permittedRadiusMetres } : {}),
        userId: data.userId?.trim() || null,
        mobile: data.mobile?.trim() || null,
        address: data.address?.trim() || null,
        architectName: data.architectName?.trim() || null,
        departmentId: data.departmentId || null,
        nodeId: data.nodeId || null,
        // Contact detail only — architects sign in with the shared CIDCO login,
        // so no account is created here.
        email: data.email?.trim().toLowerCase() || null,
        notes: data.notes ?? null,
        createdById: guard.user.id,
      },
    });

    return ok(
      {
        message:
          'Company registered. Issue its SFTP credentials, then email the user id, password and designated IP to the architect.',
        company,
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
