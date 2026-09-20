import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { readPublishedBySlug } from '@/lib/help/server';

/** GET /api/help/articles/[slug] — one published article with its body. PUBLIC, CDN-cached; a draft or an unknown slug is a 404. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const article = await readPublishedBySlug(getSupabaseAdmin(), slug);
    if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=60' } });
    return NextResponse.json({ article }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch (error) {
    console.error('[GET /api/help/articles/[slug]]', error);
    return NextResponse.json({ error: 'Could not load the article' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
