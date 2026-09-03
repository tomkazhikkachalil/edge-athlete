// ── "Your week" — the member's own view of their golf leagues (phase 6d W2)
// The ONE viewer-dependent golf-league read: the caller's approved entries
// in the org's active golf leaderboards, the round the page leads with
// (the open window, else the next, else the last), and the caller's own
// result in it. Entry-gated, so competition visibility is irrelevant (a
// member of a private league sees their own week). A guardian viewing as
// themselves sees only their own entries — no acting-as here; the child's
// bells are copied to the guardian by golf-league-notify.

import { NextResponse } from 'next/server';
import { roundRuleFor } from './golf-league';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { selectCurrentWeek, sortWeeks, utcToday, weekState, type GolfWeekState } from './golf-weeks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface MyGolfWeek {
  contestId: string;
  round: string | null;
  holes: number;
  playFrom: string;
  playTo: string;
  courseName: string | null;
  state: GolfWeekState;
}

export interface MyGolfResult {
  gross: number | null;
  net: number | null;
  holes: number | null;
  provenance: string;
}

/** P5: where the member stands in the season table. */
export interface MyGolfStanding {
  rank: number;
  points: number | null;
  of: number;
}

export interface MyGolfEntry {
  competitionId: string;
  competitionName: string;
  scoringRule: string | null;
  week: MyGolfWeek | null;
  result: MyGolfResult | null;
  standing: MyGolfStanding | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function golfMineGET(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  userId: string
): Promise<NextResponse> {
  const orgColumn = side === 'league' ? 'league_id' : 'club_id';
  const empty = NextResponse.json({ entries: [] as MyGolfEntry[] });
  empty.headers.set('Cache-Control', 'private, no-store');

  const { data: competitions, error } = await admin
    .from('competitions')
    .select('id, name, scoring_rule, config')
    .eq(orgColumn, orgId)
    .eq('sport_key', 'golf')
    .eq('format', 'leaderboard')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !competitions || competitions.length === 0) return empty;

  const { data: entries } = await admin
    .from('competition_entries')
    .select('id, competition_id')
    .in('competition_id', competitions.map(c => c.id))
    .eq('profile_id', userId)
    .eq('status', 'approved')
    .limit(20);
  if (!entries || entries.length === 0) return empty;
  const entryIds = entries.map(e => e.id as string);
  const competitionIds = [...new Set(entries.map(e => e.competition_id as string))];

  let contests: Record<string, unknown>[] = [];
  try {
    const res = await admin
      .from('contests')
      .select('id, competition_id, round, status, venue_id, holes, play_from, play_to')
      .in('competition_id', competitionIds)
      .not('holes', 'is', null)
      .neq('status', 'canceled')
      .order('play_from', { ascending: true })
      .limit(200);
    contests = (res.data ?? []) as Record<string, unknown>[];
  } catch {
    return empty; // pre-172
  }
  if (contests.length === 0) return empty;

  const contestIds = contests.map(c => c.id as string);
  const [participantsRes, venuesRes] = await Promise.all([
    admin
      .from('contest_participants')
      .select('id, contest_id, entry_id')
      .in('contest_id', contestIds)
      .in('entry_id', entryIds)
      .limit(400),
    admin
      .from('venues')
      .select('id, name, golf_course_id')
      .in('id', [...new Set(contests.map(c => c.venue_id).filter(Boolean))] as string[]),
  ]);
  const participants = participantsRes.data ?? [];
  const { data: results } = participants.length
    ? await admin
        .from('contest_results')
        .select('participant_id, score, payload, provenance')
        .in('participant_id', participants.map(p => p.id as string))
    : { data: [] as { participant_id: string; score: number | null; payload: Record<string, unknown> | null; provenance: string }[] };
  const resultByParticipant = new Map((results ?? []).map(r => [r.participant_id as string, r]));
  const participantByContest = new Map(participants.map(p => [p.contest_id as string, p.id as string]));

  const courseIds = [...new Set((venuesRes.data ?? []).map(v => v.golf_course_id).filter(Boolean))] as string[];
  const { data: courses } = courseIds.length
    ? await admin.from('golf_courses').select('id, name').in('id', courseIds)
    : { data: [] as { id: string; name: string }[] };
  const courseName = new Map((courses ?? []).map(c => [c.id as string, c.name as string]));
  const courseNameByVenue = new Map<string, string>();
  for (const v of venuesRes.data ?? []) {
    const linked = v.golf_course_id ? courseName.get(v.golf_course_id as string) : undefined;
    courseNameByVenue.set(v.id as string, linked ?? (v.name as string));
  }

  // P5: the member's season standing — their row and the field size.
  const { data: standingRows } = entryIds.length
    ? await admin
        .from('competition_standings')
        .select('competition_id, entry_id, rank, points')
        .in('competition_id', competitions.map(c => c.id as string))
        .limit(2000)
    : { data: [] as { competition_id: string; entry_id: string; rank: number; points: number | null }[] };
  const fieldSize = new Map<string, number>();
  const myStanding = new Map<string, MyGolfStanding>();
  const myEntryIds = new Set(entryIds);
  for (const r of standingRows ?? []) {
    const cid = r.competition_id as string;
    fieldSize.set(cid, (fieldSize.get(cid) ?? 0) + 1);
    if (myEntryIds.has(r.entry_id as string)) myStanding.set(cid, { rank: r.rank as number, points: (r.points as number | null) ?? null, of: 0 });
  }
  for (const [cid, st] of myStanding) st.of = fieldSize.get(cid) ?? 0;

  const today = utcToday();
  const out: MyGolfEntry[] = [];
  for (const c of competitions) {
    if (!competitionIds.includes(c.id as string)) continue;
    const weeks = sortWeeks(
      contests
        .filter(k => k.competition_id === c.id)
        .map(k => ({
          id: k.id as string,
          round: (k.round as string | null) ?? null,
          playFrom: k.play_from as string,
          playTo: k.play_to as string,
          holes: k.holes as number,
          venueId: (k.venue_id as string | null) ?? null,
        }))
    );
    const currentId = selectCurrentWeek(weeks, today);
    const current = weeks.find(w => w.id === currentId) ?? null;
    let result: MyGolfResult | null = null;
    if (current) {
      const pid = participantByContest.get(current.id);
      const r = pid ? resultByParticipant.get(pid) : undefined;
      if (r) {
        const payload = (r.payload as Record<string, unknown> | null) ?? {};
        const isNet = roundRuleFor((c.scoring_rule as string | null) ?? null, c.config) === 'golf_net';
        result = {
          gross: num(payload.gross) ?? (isNet ? null : num(r.score)),
          net: num(payload.net) ?? (isNet ? num(r.score) : null),
          holes: num(payload.holes),
          provenance: r.provenance as string,
        };
      }
    }
    out.push({
      competitionId: c.id as string,
      competitionName: c.name as string,
      scoringRule: (c.scoring_rule as string | null) ?? null,
      standing: myStanding.get(c.id as string) ?? null,
      week: current
        ? {
            contestId: current.id,
            round: current.round,
            holes: current.holes,
            playFrom: current.playFrom,
            playTo: current.playTo,
            courseName: (current.venueId && courseNameByVenue.get(current.venueId)) || null,
            state: weekState(current, today),
          }
        : null,
      result,
    });
  }
  const res = NextResponse.json({ entries: out });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
