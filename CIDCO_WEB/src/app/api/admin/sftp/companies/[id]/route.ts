import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { normalisePath } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/** Every master field is editable; anything left out is left alone. */
const text = (max: number) => z.string().max(max).nullable().optional();

const patchSchema = z.object({
  siteName: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[A-Za-z0-9 ._-]+$/, 'Site name may use letters, digits, spaces, dot, dash and underscore')
    .optional(),
  designatedPath: z.string().max(400).nullable().optional(),
  userId: text(160),
  publicKey: text(4000),
  privateKey: text(8000),
  mobile: text(40),
  email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  address: text(400),
  architectName: text(160),
  departmentId: text(40),
  nodeId: text(40),
  notes: text(300),
  registeredLatitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  registeredLongitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  permittedRadiusMetres: z.coerce.number().int().min(10).max(50_000).optional(),
  active: z.boolean().optional(),
});

/** '' from a cleared form field means "unset", not "store an empty string". */
const blank = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim();

/**
 * PATCH /api/admin/sftp/companies/:id
 *
 * Correct a registration — the architect moved server, or their export path
 * changed. Takes effect on the very next transfer, since validation reads this
 * record every time.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = patchSchema.parse(await req.json());
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) return fail('Company not found', 404);

    const updated = await prisma.company.update({
      where: { id },
      data: {
        siteName: body.siteName?.trim() ?? undefined,
        // The path is stored normalised so poll1 compares like with like.
        designatedPath:
          body.designatedPath === undefined
            ? undefined
            : body.designatedPath && body.designatedPath.trim()
              ? normalisePath(body.designatedPath)
              : '',
        userId: blank(body.userId),
        publicKey: blank(body.publicKey),
        privateKey: blank(body.privateKey),
        mobile: blank(body.mobile),
        email: blank(body.email)?.toLowerCase() ?? (body.email === undefined ? undefined : null),
        address: blank(body.address),
        architectName: blank(body.architectName),
        departmentId: blank(body.departmentId),
        nodeId: blank(body.nodeId),
        notes: blank(body.notes),
        registeredLatitude: body.registeredLatitude === undefined ? undefined : body.registeredLatitude,
        registeredLongitude: body.registeredLongitude === undefined ? undefined : body.registeredLongitude,
        permittedRadiusMetres: body.permittedRadiusMetres ?? undefined,
        active: body.active ?? undefined,
      },
      include: { department: true, node: true },
    });

    return ok({
      message: 'Registration updated. It applies to the next transfer.',
      // Never hand a stored private key back to a browser.
      company: { ...updated, privateKey: updated.privateKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : null },
    });
  } catch (error) {
    return handleError(error);
  }
}
