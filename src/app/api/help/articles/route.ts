import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { readPublished } from '@/lib/help/server';

/**
 * GET /api/help/articles — the Help Center's published articles (Support &
 * Reporting, Spec 3). PUBLIC and viewer-independent, so it is CDN-cached
 * (`s-maxage=300`); an article edit shows within five minutes. Pre-224:
 * `supported: false` with an empty list, never a 500.
 */
export async function GET() {
  try {
    const result = await readPublished(getSupabaseAdmin());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch (error) {
    console.error('[GET /api/help/articles]', error);
    return NextResponse.json({ error: 'Could not load the articles' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
