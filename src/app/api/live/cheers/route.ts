import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { isCheerKey } from '@/lib/play/cheers';
import { addCheer, cheerGate, readCheerFeed } from '@/lib/play/cheers-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/live/cheers — live-round cheers (the Play program, 244), for every
 * sport: `context` is a golf shared round (`group_post:<id>`) or a stat
 * event's round (`sport_event_round:<id>`).
 *
 * GET ?context=: the counts and the last 30 s of cheers, for anyone who may
 * watch the round (signed out too, on a public round). POST { context,
 * cheer, target? }: a signed-in watcher cheers a LIVE round; the target,
 * when named, must be one of its players. The context's own gate runs on
 * both; a refusal is the 404 an unknown round gets. Anonymous by design (no
 * name rides a cheer), so — like a like — no write gate; the `cheer` bucket
 * (with `write-general`, one trip) keeps a held finger from being a flood.
 *
 * The read of a PUBLIC round is one CDN copy for 10 s (scale round 2, Nov 7
 * 2026 — SCALE_AUDIT hole 5's second half): the payload carries no viewer
 * field, the gate's only viewer-dependence is the 404, and a `since` no
 * longer splits the key (the window is the server's; the client dedupes).
 * Vercel's edge consumes `s-maxage` whatever vercel.json says of /api/* —
 * the Sep 16 trap, used on purpose here. A private round, and every
 * refusal, stays `private, no-store`.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store' };
const PUBLIC_ROUND = { 'Cache-Control': 'public, max-age=5, s-maxage=10' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE });

export async function GET(request: NextRequest) {
  try {
    const context = request.nextUrl.searchParams.get('context') ?? '';
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const gate = await cheerGate(admin, context, user?.id ?? null);
    if (!gate) return notFound();
    const feed = await readCheerFeed(admin, context);
    return NextResponse.json({ ...feed, live: gate.live }, { headers: gate.publicView ? PUBLIC_ROUND : PRIVATE });
  } catch (error) {
    reportRouteError('GET cheers error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, limited } = await getServerAuth(request, { limit: 'cheer' });
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as { context?: unknown; cheer?: unknown; target?: unknown } | null;
    const context = typeof body?.context === 'string' ? body.context : '';
    if (!isCheerKey(body?.cheer)) return NextResponse.json({ error: 'Pick a cheer' }, { status: 400 });
    const target = body?.target === undefined || body?.target === null ? null : body.target;
    if (target !== null && (typeof target !== 'string' || !isUuid(target))) return NextResponse.json({ error: 'Invalid player' }, { status: 400 });
    const admin = getSupabaseAdmin();
    const gate = await cheerGate(admin, context, user.id);
    if (!gate) return notFound();
    if (!gate.live) return NextResponse.json({ error: 'This round is not live.' }, { status: 409 });
    if (target && !gate.players.has(target)) return NextResponse.json({ error: 'That player is not in this round.' }, { status: 400 });
    const added = await addCheer(admin, context, user.id, body!.cheer as never, target as string | null);
    if (!added) return NextResponse.json({ error: 'Could not send your cheer.' }, { status: 500 });
    const feed = await readCheerFeed(admin, context);
    return NextResponse.json({ id: added.id, at: added.at, totals: feed.totals, total: feed.total }, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('POST cheers error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
