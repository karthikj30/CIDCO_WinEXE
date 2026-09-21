/**
 * Puts the static assets next to the standalone server.
 *
 * `output: 'standalone'` builds a self-contained `.next/standalone/server.js`,
 * but Next deliberately leaves `.next/static` and `public/` out of it — they
 * are meant to go on a CDN, so it will not guess that you want them served by
 * the same process.
 *
 * Run that server without copying them and every page answers 200 while every
 * stylesheet and script under /_next/static/ answers 404: the HTML arrives and
 * nothing else does, so the site renders as unstyled text. Nothing in the
 * output says why, which is what makes it worth automating rather than
 * documenting.
 *
 * Runs automatically after `npm run build` (npm's postbuild hook).
 */
import { cp, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

const exists = (p) => stat(p).then(() => true, () => false);

if (!(await exists(standalone))) {
  // A plain build without output:'standalone'. `next start` serves the assets
  // itself, so there is nothing to do.
  console.log('No .next/standalone — nothing to copy.');
  process.exit(0);
}

for (const [from, to, label] of [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), '.next/static'],
  [path.join(root, 'public'), path.join(standalone, 'public'), 'public'],
]) {
  if (!(await exists(from))) continue;
  await cp(from, to, { recursive: true });
  console.log(`Copied ${label} into .next/standalone/`);
}
