import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { readPublished } from '@/lib/help/server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/help/articles — the Help Center's published articles (Support &
 * Reporting, Spec 3). PUBLIC and viewer-independent, so it is CDN-cached
 * (`s-maxage=60`); an article edit shows within a minute — Vercel consumes the directive and answers `cache-control: public`. Pre-224:
 * `supported: false` with an empty list, never a 500.
 */
export async function GET() {
  try {
    const result = await readPublished(getSupabaseAdmin());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (error) {
    reportRouteError('[GET /api/help/articles]', error);
    return NextResponse.json({ error: 'Could not load the articles' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
