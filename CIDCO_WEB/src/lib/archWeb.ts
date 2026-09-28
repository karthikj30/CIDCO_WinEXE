/**
 * Where the architect's API portal lives.
 *
 * The API channel runs as its own app, `arch_web`, on its own port — so every
 * URL CIDCO hands an architect for that channel has to point there, not at the
 * portal the officer happens to be looking at.
 *
 * `ARCH_WEB_URL` is the one setting, read at request time so that moving the
 * portal is an .env edit and a reload, never a rebuild. Leave it unset and everything
 * falls back to the current origin, which is exactly what it did before the
 * split, so an installation that has not been reconfigured keeps working.
 *
 * The SFTP channel is untouched by any of this: the Windows agent still posts
 * to this portal, and /architect/sftp is still served here.
 */
export function archWebUrl(fallbackOrigin?: string | null): string {
  const configured = process.env.ARCH_WEB_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return (fallbackOrigin ?? '').replace(/\/+$/, '');
}
