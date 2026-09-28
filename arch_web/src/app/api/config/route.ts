import { NextResponse } from 'next/server';
import { cidcoWebUrl } from '@/lib/cidcoWeb';

export const dynamic = 'force-dynamic';

/** Runtime settings the browser needs. Nothing secret; see CIDCO_WEB's copy. */
export async function GET() {
  return NextResponse.json({ success: true, data: { cidcoWebUrl: cidcoWebUrl() } });
}
