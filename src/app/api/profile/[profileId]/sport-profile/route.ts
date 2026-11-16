import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { readSportProfile, sportProfilePayload, sportProfileViewer } from '@/lib/sport-profile/sport-profile-server';
import { reportRouteError } from '@/lib/observability/report';
import { readGolfClips, readGolfProfile, readGolfSeasonHoles } from '@/lib/sport-profile/golf-profile-server';
import { parseGolfYear } from '@/lib/sport-profile/golf-rules';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: PRIVATE });

/**
 * GET /api/profile/[profileId]/sport-profile?sport=…[&spoilers=show]
 *
 * The athlete's sport profile (Sprint 4; docs/specs/sport-profile.md):
 * career, one row per season, and every game — judged by the same-game
 * rule, so the numbers are the Stats tab's. A spoiler-free game counts in
 * the totals; its own line is sent only when the viewer asks
 * (`spoilers=show`), or is the athlete, their guardian or a manager of the
 * video. The clips are the sport-clips route's. `supported: false` for a
 * sport with no stat sheet here.
 *
 * `sport=golf` answers golf's own payload (`kind: 'golf'`: handicap, career,
 * one row per calendar year, the rounds this viewer may list) and, with
 * `&holes=<year>`, that season's holes and media by round; `&media=all`
 * is every photo and clip of the listed rounds. A round its owner hid
 * counts in every total and is never listed, or sent, to anyone else.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NOT_FOUND();
    const sport = request.nextUrl.searchParams.get('sport') ?? '';
    if (!/^[a-z0-9_]{2,40}$/.test(sport)) return NextResponse.json({ error: 'Choose the sport' }, { status: 400, headers: PRIVATE });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const who = await sportProfileViewer(admin, user ?? null, profileId);
    if (!who) return NOT_FOUND();
    // Golf (one wave, phase 3): scores against par are not stat lines — its own payload (`kind: 'golf'`), the same gate.
    // `&holes=<year>` answers that season's holes by round instead (the scorecards behind the season's doors).
    if (sport === 'golf') {
      const seesHidden = who.actsForProfile;
      const year = parseGolfYear(request.nextUrl.searchParams.get('holes'));
      if (year) {
        const season = await readGolfSeasonHoles(admin, profileId, year, seesHidden, who.user?.id ?? null);
        if (!season) return NextResponse.json({ error: 'Could not load the rounds' }, { status: 500, headers: PRIVATE });
        return NextResponse.json({ supported: true, kind: 'golf-holes', year, holes: season.holes, media: season.media, official: season.official }, { headers: PRIVATE });
      }
      // `&media=all`: every photo and clip of the listed rounds — golf's Clips tab.
      if (request.nextUrl.searchParams.get('media') === 'all') {
        const media = await readGolfClips(admin, profileId, seesHidden, who.user?.id ?? null);
        if (!media) return NextResponse.json({ error: 'Could not load the clips' }, { status: 500, headers: PRIVATE });
        return NextResponse.json({ supported: true, kind: 'golf-media', media }, { headers: PRIVATE });
      }
      const golf = await readGolfProfile(admin, profileId, seesHidden);
      if (!golf) return NextResponse.json({ error: 'Could not load the rounds' }, { status: 500, headers: PRIVATE });
      return NextResponse.json({ supported: true, ...golf, can_edit: who.actsForProfile }, { headers: PRIVATE });
    }
    const read = await readSportProfile(admin, profileId, sport, who.user, who);
    if (!read) return NextResponse.json({ supported: false, sport }, { headers: PRIVATE });
    const showHeld = request.nextUrl.searchParams.get('spoilers') === 'show';
    return NextResponse.json({ supported: true, ...sportProfilePayload(read, showHeld), can_edit: who.actsForProfile }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/sport-profile] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
