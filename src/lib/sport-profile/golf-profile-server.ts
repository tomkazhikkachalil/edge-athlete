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
import { golfListed, golfSeasonOf, golfSeasons, golfTotals, type GolfHoleRow, type GolfRound, type GolfRoundListed, type GolfSeason, type GolfTotals } from './golf-rules';

const PAGE = 1000;
export const GOLF_ROUNDS_MAX = 5000;
const HOLE_BATCH_ROUNDS = 55;
const HOLE_BATCHES_AT_ONCE = 4;

interface RoundRow { id: string; date: string; course: string; course_location: string | null; tee: string | null; holes: number; round_type: string | null; par: number | null; gross_score: number | null; is_complete: boolean | null; profile_hidden_at: string | null }
interface HoleRow { round_id: string; hole_number: number; par: number | null; strokes: number | null; putts: number | null; fairway_hit: boolean | null; green_in_regulation: boolean | null; penalties: string[] | null }

async function readRounds(admin: SupabaseClient, profileId: string, year: string | null): Promise<RoundRow[] | null> {
  const rows: RoundRow[] = [];
  for (let from = 0; from < GOLF_ROUNDS_MAX; from += PAGE) {
    let q = admin.from('golf_rounds').select('id, date, course, course_location, tee, holes, round_type, par, gross_score, is_complete, profile_hidden_at').eq('profile_id', profileId);
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
      batches.slice(i, i + HOLE_BATCHES_AT_ONCE).map(ids => admin.from('golf_holes').select('round_id, hole_number, par, strokes, putts, fairway_hit, green_in_regulation, penalties').in('round_id', ids).order('hole_number', { ascending: true }))
    );
    for (const { data, error } of answers) {
      if (error) {
        console.error('[golf-profile] holes read failed:', error.message);
        return null;
      }
      for (const h of (data ?? []) as HoleRow[]) {
        const list = by.get(h.round_id) ?? [];
        list.push({ n: h.hole_number, par: h.par, strokes: h.strokes, putts: h.putts, fairway: h.fairway_hit, green: h.green_in_regulation, penalties: Array.isArray(h.penalties) ? h.penalties.length : 0 });
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

/** One season's holes, by round — only the rounds this viewer may list. */
export async function readGolfSeasonHoles(admin: SupabaseClient, profileId: string, year: string, seesHidden: boolean): Promise<Record<string, GolfHoleRow[]> | null> {
  const rows = await readRounds(admin, profileId, year);
  if (!rows) return null;
  const listed = rows.filter(r => golfSeasonOf(r.date) === year && (seesHidden || r.profile_hidden_at === null));
  const holes = await readHoles(admin, listed.map(r => r.id));
  if (!holes) return null;
  return Object.fromEntries(listed.map(r => [r.id, holes.get(r.id) ?? []]));
}
