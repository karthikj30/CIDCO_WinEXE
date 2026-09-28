/**
 * Where the CIDCO portal lives.
 *
 * This app serves the architect's API channel and nothing else, so everything
 * else an architect might click — the SFTP portal, the front door, the docs —
 * is on the CIDCO portal, usually on a different port.
 *
 * Read at request time from `CIDCO_WEB_URL`, never baked into the bundle: the
 * server is re-addressed often enough that moving it must be an .env edit and
 * a reload, not a rebuild. Unset, the links stay relative and behave as they
 * did when both halves were one app.
 */
export function cidcoWebUrl(): string {
  return (process.env.CIDCO_WEB_URL ?? '').trim().replace(/\/+$/, '');
}
