// ── Golf's sport profile: the reader (server) ────────────────────────────────
// "One wave", phase 3 (Nov 2026). Set-based: the athlete's rounds in pages of
// a thousand, their holes in batches of 55 rounds (55 × 18 = 990, under
// PostgREST's 1,000-row answer — handicap-server.ts met that cap). Admin
// client; the ROUTE decides who may read (sportProfileViewer).
//
// Results are never lost (241): the TOTALS are folded over every round, a
// hidden one included; the LIST — and the holes — a non-owner receives never
// hold a hidden round.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';
import { mapBounded } from '@/lib/bounded-map';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { resolveResultOrigin } from '@/lib/results/origin-server';
import { golfListed, golfSeasonOf, golfSeasons, golfTotals, mayViewRoundMedia, type GolfHoleRow, type GolfMedia, type GolfRound, type GolfRoundListed, type GolfSeason, type GolfTotals } from './golf-rules';

const PAGE = 1000;
export const GOLF_ROUNDS_MAX = 5000;
const HOLE_BATCH_ROUNDS = 55;
const HOLE_BATCHES_AT_ONCE = 4;

interface RoundRow { id: string; date: string; course: string; course_location: string | null; tee: string | null; holes: number; round_type: string | null; par: number | null; gross_score: number | null; is_complete: boolean | null; profile_hidden_at: string | null; group_post_id: string | null }
interface HoleRow { round_id: string; hole_number: number; par: number | null; par_estimated: boolean | null; strokes: number | null; putts: number | null; fairway_hit: boolean | null; green_in_regulation: boolean | null; penalties: string[] | null }

async function readRounds(admin: SupabaseClient, profileId: string, year: string | null): Promise<RoundRow[] | null> {
  const rows: RoundRow[] = [];
  for (let from = 0; from < GOLF_ROUNDS_MAX; from += PAGE) {
    let q = admin.from('golf_rounds').select('id, date, course, course_location, tee, holes, round_type, par, gross_score, is_complete, profile_hidden_at, group_post_id').eq('profile_id', profileId);
    if (year) q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
    const { data, error } = await q.order('date', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1);
    if (error) {
      console.error('[golf-profile] rounds read failed:', error.message);
      return null;
    }
    rows.push(...((data ?? []) as RoundRow[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function readHoles(admin: SupabaseClient, roundIds: readonly string[]): Promise<Map<string, GolfHoleRow[]> | null> {
  const batches: string[][] = [];
  for (let i = 0; i < roundIds.length; i += HOLE_BATCH_ROUNDS) batches.push(roundIds.slice(i, i + HOLE_BATCH_ROUNDS));
  const by = new Map<string, GolfHoleRow[]>();
  for (let i = 0; i < batches.length; i += HOLE_BATCHES_AT_ONCE) {
    const answers = await Promise.all(
      batches.slice(i, i + HOLE_BATCHES_AT_ONCE).map(ids => admin.from('golf_holes').select('round_id, hole_number, par, par_estimated, strokes, putts, fairway_hit, green_in_regulation, penalties').in('round_id', ids).order('hole_number', { ascending: true }))
    );
    for (const { data, error } of answers) {
      if (error) {
        console.error('[golf-profile] holes read failed:', error.message);
        return null;
      }
      for (const h of (data ?? []) as HoleRow[]) {
        const list = by.get(h.round_id) ?? [];
        list.push({ n: h.hole_number, par: h.par, ...(h.par_estimated === true ? { parEst: true as const } : {}), strokes: h.strokes, putts: h.putts, fairway: h.fairway_hit, green: h.green_in_regulation, penalties: Array.isArray(h.penalties) ? h.penalties.length : 0 });
        by.set(h.round_id, list);
      }
    }
  }
  return by;
}

const toRound = (r: RoundRow, holes: Map<string, GolfHoleRow[]>): GolfRound => ({
  id: r.id,
  date: r.date,
  course: r.course,
  location: r.course_location,
  tee: r.tee,
  holes: r.holes,
  type: r.round_type,
  par: r.par,
  gross: r.gross_score,
  complete: r.is_complete === true,
  hidden: r.profile_hidden_at !== null,
  holeRows: holes.get(r.id) ?? [],
});

export interface GolfProfilePayload {
  kind: 'golf';
  sport: 'golf';
  /** The WHS-style estimate and its history (handicap.ts) — null until a rated round counts. */
  handicap: { index: number | null; provisional: boolean; series: Array<{ date: string; index: number; provisional?: boolean }> };
  career: GolfTotals;
  seasons: GolfSeason[];
  /** Every round this viewer may list, newest first, without holes. */
  rounds: GolfRoundListed[];
  capped: boolean;
}

/** The whole profile: totals over every round, the list this viewer may see. */
export async function readGolfProfile(admin: SupabaseClient, profileId: string, seesHidden: boolean): Promise<GolfProfilePayload | null> {
  const rows = await readRounds(admin, profileId, null);
  if (!rows) return null;
  const [holes, handicap] = await Promise.all([readHoles(admin, rows.map(r => r.id)), fetchHandicapComputation(profileId, admin)]);
  if (!holes) return null;
  const rounds = rows.map(r => toRound(r, holes));
  const last = handicap.series[handicap.series.length - 1];
  return {
    kind: 'golf',
    sport: 'golf',
    handicap: { index: last ? last.index : null, provisional: last?.provisional === true, series: handicap.series },
    career: golfTotals(rounds, seesHidden),
    seasons: golfSeasons(rounds, seesHidden),
    rounds: golfListed(rounds, seesHidden),
    capped: rows.length >= GOLF_ROUNDS_MAX,
  };
}

export const GOLF_MEDIA_MAX = 600;
const IN_BATCH = 100;

/**
 * The photos and clips of the given (already listed) rounds — a shared round's
 * media, by hole. A round's media is shown only to someone its own rule admits
 * (mayViewRoundMedia: public, the creator, a participant); the addresses are
 * the media proxy's, which asks the same question again for the bytes.
 * A failed read costs the media, never the scorecards.
 */
async function readMedia(admin: SupabaseClient, rows: readonly RoundRow[], viewerId: string | null): Promise<GolfMedia[]> {
  const roundOf = new Map<string, string>();
  for (const r of rows) if (r.group_post_id) roundOf.set(r.group_post_id, r.id);
  const groupIds = [...roundOf.keys()];
  if (groupIds.length === 0) return [];
  try {
    interface MediaRow { id: string; group_post_id: string; media_url: string; media_type: string; thumbnail_url: string | null; segment_number: number | null; duration_seconds: number | null }
    const media: MediaRow[] = [];
    for (let i = 0; i < groupIds.length && media.length < GOLF_MEDIA_MAX; i += IN_BATCH) {
      const { data, error } = await admin.from('group_post_media').select('id, group_post_id, media_url, media_type, thumbnail_url, segment_number, duration_seconds').in('group_post_id', groupIds.slice(i, i + IN_BATCH)).order('created_at', { ascending: true }).limit(GOLF_MEDIA_MAX);
      if (error) throw new Error(error.message);
      media.push(...((data ?? []) as MediaRow[]));
    }
    const withMedia = [...new Set(media.map(m => m.group_post_id))];
    if (withMedia.length === 0) return [];
    const [groups, mine] = await Promise.all([
      admin.from('group_posts').select('id, visibility, creator_id').in('id', withMedia.slice(0, 1000)),
      viewerId ? admin.from('group_post_participants').select('group_post_id').eq('profile_id', viewerId).in('group_post_id', withMedia.slice(0, 1000)) : Promise.resolve({ data: [] as Array<{ group_post_id: string }>, error: null }),
    ]);
    if (groups.error || mine.error) throw new Error(groups.error?.message ?? mine.error?.message);
    const participant = new Set(((mine.data ?? []) as Array<{ group_post_id: string }>).map(p => p.group_post_id));
    const open = new Set(
      ((groups.data ?? []) as Array<{ id: string; visibility: string | null; creator_id: string | null }>)
        .filter(g => mayViewRoundMedia({ visibility: g.visibility, creatorId: g.creator_id }, viewerId, participant.has(g.id)))
        .map(g => g.id)
    );
    return media
      .filter(m => open.has(m.group_post_id) && (m.media_type === 'image' || m.media_type === 'video'))
      .slice(0, GOLF_MEDIA_MAX)
      .map(m => ({
        id: m.id,
        roundId: roundOf.get(m.group_post_id)!,
        n: m.segment_number,
        type: m.media_type as 'image' | 'video',
        url: toProxyUrl(m.media_url, { type: 'group', id: m.group_post_id }) ?? m.media_url,
        poster: toProxyUrl(m.thumbnail_url, { type: 'group', id: m.group_post_id }),
        seconds: m.duration_seconds,
      }));
  } catch (error) {
    console.error('[golf-profile] media read failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Which of the given rounds are OFFICIAL — played in an organization's event
 * (resolveResultOrigin, the one rule). Only a shared round can be: the rule
 * reads one result at a time, so it is asked a season at a time, five in
 * flight, and never for the whole career's list. An answer the rule could not
 * read (`unknown`, its fail-closed default) is not shown as official.
 */
async function officialRounds(admin: SupabaseClient, rows: readonly RoundRow[]): Promise<string[]> {
  const shared = rows.filter(r => r.group_post_id);
  const origins = await mapBounded(shared, 5, r => resolveResultOrigin(admin, { kind: 'golf_round', id: r.id }).catch(() => null));
  return shared.filter((_, i) => origins[i]?.official === true && origins[i]?.unknown === false && origins[i]?.eventId).map(r => r.id);
}

/** One season's holes and media, by round, and which rounds are official — only the rounds this viewer may list. */
export async function readGolfSeasonHoles(admin: SupabaseClient, profileId: string, year: string, seesHidden: boolean, viewerId: string | null): Promise<{ holes: Record<string, GolfHoleRow[]>; media: GolfMedia[]; official: string[] } | null> {
  const rows = await readRounds(admin, profileId, year);
  if (!rows) return null;
  const listed = rows.filter(r => golfSeasonOf(r.date) === year && (seesHidden || r.profile_hidden_at === null));
  const [holes, media, official] = await Promise.all([readHoles(admin, listed.map(r => r.id)), readMedia(admin, listed, viewerId), officialRounds(admin, listed)]);
  if (!holes) return null;
  return { holes: Object.fromEntries(listed.map(r => [r.id, holes.get(r.id) ?? []])), media, official };
}

/** Every photo and clip of the rounds this viewer may list — golf's Clips tab. Newest round first. */
export async function readGolfClips(admin: SupabaseClient, profileId: string, seesHidden: boolean, viewerId: string | null): Promise<GolfMedia[] | null> {
  const rows = await readRounds(admin, profileId, null);
  if (!rows) return null;
  const listed = rows.filter(r => seesHidden || r.profile_hidden_at === null);
  const order = new Map(listed.map((r, i) => [r.id, i]));
  return (await readMedia(admin, listed, viewerId)).sort((a, b) => (order.get(a.roundId)! - order.get(b.roundId)!) || ((a.n ?? 99) - (b.n ?? 99)));
}
