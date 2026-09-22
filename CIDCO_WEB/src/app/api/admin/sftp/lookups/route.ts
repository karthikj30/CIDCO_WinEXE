import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * Nodes and departments — the two lists the company form picks from.
 *
 * They are tables rather than a hard-coded array so an officer can add one
 * from the portal when CIDCO opens a node, instead of waiting for a deploy.
 */

/** GET /api/admin/sftp/lookups */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const [nodes, departments] = await Promise.all([
      prisma.node.findMany({ orderBy: { name: 'asc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
    ]);

    return ok({
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, active: n.active })),
      departments: departments.map((d) => ({ id: d.id, name: d.name, active: d.active })),
    });
  } catch (error) {
    return handleError(error);
  }
}

const createSchema = z.object({
  kind: z.enum(['node', 'department']),
  name: z.string().min(2, 'A name of at least 2 characters is required').max(120),
});

/**
 * POST /api/admin/sftp/lookups — add a node or a department.
 *
 * Adding one that already exists returns it rather than failing: from the
 * company form this is "use this node", and two officers typing the same new
 * node at the same time should both end up pointing at the same row.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const { kind, name } = createSchema.parse(await req.json());
    const clean = name.trim();
    if (!clean) return fail('A name is required', 422);

    if (kind === 'node') {
      const existing = await prisma.node.findUnique({ where: { name: clean } });
      const node = existing ?? (await prisma.node.create({ data: { name: clean } }));
      return ok({ kind, item: { id: node.id, name: node.name, active: node.active } }, existing ? 200 : 201);
    }

    const existing = await prisma.department.findUnique({ where: { name: clean } });
    const dept = existing ?? (await prisma.department.create({ data: { name: clean } }));
    return ok({ kind, item: { id: dept.id, name: dept.name, active: dept.active } }, existing ? 200 : 201);
  } catch (error) {
    return handleError(error);
  }
}
