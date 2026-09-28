/**
 * Brings the Prisma schema in from the CIDCO portal before generating.
 *
 * There is one schema and one set of migrations, and they belong to
 * CIDCO_WEB — two apps writing the same tables must not each hold an opinion
 * about their shape.
 *
 * But `prisma generate --schema ../CIDCO_WEB/prisma/schema.prisma` writes the
 * client next to *that* schema, into CIDCO_WEB's node_modules. That is
 * invisible while the two share a node_modules and breaks the moment they do
 * not: this app installs its own, finds no generated client, and every Prisma
 * type resolves to `any` until the build fails on it.
 *
 * So the schema is copied here first and generated from the copy. The copy is
 * never edited and never committed — it is rewritten on every build, so it
 * cannot drift from the original.
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', 'CIDCO_WEB', 'prisma', 'schema.prisma');
const target = join(here, '..', 'prisma', 'schema.prisma');

const exists = (p) => access(p).then(() => true, () => false);

if (await exists(source)) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log('[schema] copied from CIDCO_WEB/prisma/schema.prisma');
} else if (await exists(target)) {
  // Deployed on its own, with the schema shipped alongside. Legitimate.
  console.log('[schema] CIDCO_WEB not alongside — using the copy already here.');
} else {
  console.error(
    '\n[schema] No schema found.\n\n' +
      '  Expected CIDCO_WEB/prisma/schema.prisma one folder up, or a copy at\n' +
      '  arch_web/prisma/schema.prisma. This app generates its Prisma client\n' +
      "  from the CIDCO portal's schema, because there is only one.\n",
  );
  process.exit(1);
}
