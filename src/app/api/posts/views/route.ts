import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { isBotUA, optedOut } from '@/lib/org-sites/analytics';
import { parseViewItems } from '@/lib/views/hash';
import { recordPostViews } from '@/lib/views/server';
import { reportRouteError } from '@/lib/observability/report';

// ── POST /api/posts/views — the impact beacon (252) ───────────────────────
// Body: { items: [{ id, kind: 'view' | 'play' }] } (≤ 50). Answers 204
// WHATEVER happens — over the limit, a bot, an opted-out browser (Sec-GPC /
// DNT), no salt, a bad body, a database error (the csp-report precedent: a
// beacon is never sent a 429 or a 500). Signed in or out: a session marks the
// viewer by user id, anonymous by ip + user agent; nothing about who is
// stored. Not on the write gate (a read-side signal, not content).

const NO_CONTENT = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  try {
    const ua = request.headers.get('user-agent');
    if (isBotUA(ua) || optedOut(request.headers)) return NO_CONTENT();
    if (await enforceRateLimit(request, 'post-views')) return NO_CONTENT();

    const body = await request.json().catch(() => null);
    const items = parseViewItems(body);
    if (!items || items.length === 0) return NO_CONTENT();

    const { user } = await getServerAuth(request);
    const viewer = user ? { userId: user.id } : { ip: getClientIp(request) ?? '0.0.0.0', ua: ua ?? '' };
    await recordPostViews(getSupabaseAdmin(), { items, viewer, viewerId: user?.id ?? null });
    return NO_CONTENT();
  } catch (error) {
    reportRouteError('[post-views] beacon error (answering 204):', error);
    return NO_CONTENT();
  }
}
