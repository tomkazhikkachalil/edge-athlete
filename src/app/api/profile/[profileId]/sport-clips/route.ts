import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { GAME_KEY_RE } from '@/lib/performance/same-game';
import { forViewer, gamesOfSeason, pageOf, reelOf } from '@/lib/sport-profile/rules';
import { readSportProfile, sportProfileViewer } from '@/lib/sport-profile/sport-profile-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: PRIVATE });
const KEY = /^[a-z0-9_]{2,40}$/;

/**
 * GET /api/profile/[profileId]/sport-clips?sport=…
 *       [&season=2025-26][&game=film:<id>][&stat=goals][&event=goal][&period=2]
 *       [&scope=all][&spoilers=show][&cursor=0][&limit=60]
 *
 * The play level (Sprint 4): the athlete's clips, oldest game first and in
 * game order — the reel behind a number, or the Clips browser
 * (`scope=all`: every film game the viewer may watch, recreational
 * included; a number's reel is verified film only). Each clip names its
 * game. A spoiler-free game gives no clips until the viewer asks.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NOT_FOUND();
    const q = request.nextUrl.searchParams;
    const sport = q.get('sport') ?? '';
    if (!KEY.test(sport)) return NextResponse.json({ error: 'Choose the sport' }, { status: 400, headers: PRIVATE });
    const game = q.get('game');
    const stat = q.get('stat');
    const event = q.get('event');
    const season = q.get('season');
    const periodRaw = q.get('period');
    const period = periodRaw === null ? null : Number(periodRaw);
    if ((game && !GAME_KEY_RE.test(game)) || (stat && !KEY.test(stat)) || (event && !KEY.test(event)) || (season && !/^[0-9a-z-]{4,10}$/.test(season)) || (period !== null && (!Number.isInteger(period) || period < 1 || period > 99))) {
      return NextResponse.json({ error: 'That is not a set of clips' }, { status: 400, headers: PRIVATE });
    }
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const who = await sportProfileViewer(admin, user ?? null, profileId);
    if (!who) return NOT_FOUND();
    const read = await readSportProfile(admin, profileId, sport, who.user, who);
    if (!read) return NextResponse.json({ supported: false, clips: [], next: null, total: 0 }, { headers: PRIVATE });
    const showHeld = q.get('spoilers') === 'show';
    // What the athlete hid from their page is cut for everyone else, before anything is listed.
    const visible = forViewer(read.games, read.seesHidden);
    const all = showHeld ? visible.map(g => ({ ...g, held: false })) : visible;
    const scoped = season ? gamesOfSeason(all, season, read.seasonKeyOf) : all;
    const reel = reelOf(scoped, { game, stat, event, period, everyFilm: q.get('scope') === 'all' });
    const page = pageOf(reel, Number(q.get('cursor') ?? 0), Number(q.get('limit') ?? 0));
    return NextResponse.json({ supported: true, clips: page.items, next: page.next, total: reel.length }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/sport-clips] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
