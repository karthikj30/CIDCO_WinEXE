import { NextResponse } from 'next/server';
import { archWebUrl } from '@/lib/archWeb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config
 *
 * The handful of settings the browser needs that are not known until the
 * server is running.
 *
 * A NEXT_PUBLIC_ variable would be simpler, but Next bakes those into the
 * bundle at build time — so moving the architect portal to a different host or
 * port would mean rebuilding rather than editing .env and reloading. This
 * server is rebuilt and re-addressed often enough that the address must not be
 * a build artefact.
 *
 * Nothing secret goes here: it is served to anyone who asks.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      // Empty means "this portal", which is how it behaved before the split.
      archWebUrl: archWebUrl(''),
    },
  });
}
