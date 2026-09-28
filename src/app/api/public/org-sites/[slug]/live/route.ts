import { NextRequest, NextResponse } from 'next/server';
import { readLiveFeed } from '@/lib/org-sites/live-feed-server';
import { idleFeed } from '@/lib/org-sites/live-feed';
import { reportRouteError } from '@/lib/observability/report';
import { SUBDOMAIN_MAX, SUBDOMAIN_RE } from '@/lib/org-sites/validate';

// ── GET /api/public/org-sites/[slug]/live — a site's live scoreboard feed ──
// Sports-team website program, V1 (Sep 28 2026). The ONE public, polled read
// behind the site's live card:
//   • no auth, no cookie, no request header — viewer-independent, so the edge
//     may cache one copy for everyone (200: s-maxage=10, SWR 10);
//   • a query string is a 400 (it would split the cache — a poller that
//     busts it would reach the origin every time);
//   • no rate bucket, on purpose: with the query refused, the edge answers
//     every poll inside the 10 s window, so the origin sees at most one read
//     per slug per window whatever the traffic; a bucket would only add a
//     database round trip to each of those;
//   • unpublished / private / schedule off → 404; every non-200 is no-store;
//   • the kill switch (runtime env PUBLIC_LIVE_SCORES=0) answers an IDLE feed
//     (pollMs 0), so every open card stops asking.

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (request.nextUrl.search) return NextResponse.json({ error: 'No query parameters' }, { status: 400, headers: NO_STORE });
    const { slug } = await params;
    if (slug.length > SUBDOMAIN_MAX || !SUBDOMAIN_RE.test(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const now = Date.now();
    if (process.env.PUBLIC_LIVE_SCORES === '0') {
      return NextResponse.json(idleFeed(now), { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
    }
    const feed = await readLiveFeed(slug, now);
    if (!feed) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(feed, { headers: { 'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=10' } });
  } catch (error) {
    reportRouteError('[ORG SITE LIVE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
