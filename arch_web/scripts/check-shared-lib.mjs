/**
 * The architect portal carries its own copy of the plumbing it shares with the
 * CIDCO portal — auth, the Prisma client, validation, the handshake rules — so
 * that it can be built and deployed on its own.
 *
 * A copy drifts. The failure that causes is nasty and quiet: a token that
 * validates on one port and not the other, or a password hashed one way and
 * checked another. This fails the build the moment the two differ, naming the
 * file, so the copy is a deliberate act rather than something that rots.
 *
 * Run automatically before every build.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mine = join(here, '..', 'src', 'lib');
const theirs = join(here, '..', '..', 'CIDCO_WEB', 'src', 'lib');

const SHARED = [
  'api.ts', 'auth.ts', 'fetchJson.ts', 'guards.ts', 'handshake.ts',
  'logger.ts', 'prisma.ts', 'reports.ts', 'storage.ts', 'validation.ts',
  'archWeb.ts', 'readings.ts',
];

if (!existsSync(theirs)) {
  // Deployed on its own, without the CIDCO portal beside it. Nothing to
  // compare against, and that is a legitimate way to run this.
  console.log('[shared-lib] CIDCO_WEB not alongside — skipping the drift check.');
  process.exit(0);
}

const drifted = SHARED.filter((f) => {
  const a = join(mine, f), b = join(theirs, f);
  if (!existsSync(a) || !existsSync(b)) return true;
  return readFileSync(a, 'utf8') !== readFileSync(b, 'utf8');
});

if (drifted.length === 0) {
  console.log(`[shared-lib] ${SHARED.length} shared modules match CIDCO_WEB.`);
  process.exit(0);
}

console.error(`\n[shared-lib] These differ from CIDCO_WEB/src/lib:\n`);
for (const f of drifted) console.error(`    ${f}`);
console.error(`
Both portals sign and read the same sessions against the same database, so
these have to agree. Copy the changed file across:

    cp ../CIDCO_WEB/src/lib/<file> src/lib/<file>

or, if the difference is deliberate, take the file out of SHARED in
scripts/check-shared-lib.mjs and say why.
`);
process.exit(1);
