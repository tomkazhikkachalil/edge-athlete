/**
 * Golf leagues — the SERVER half (phase 6c G2): the sync engine that
 * fills a league round from member-posted golf rounds, the manager's
 * confirm, and the daily cron phase.
 *
 * THE FROZEN-PATH AUDIT: this module READS golf_rounds, golf_holes,
 * golf_courses and venues, and WRITES contest_results, contests.status and
 * (via recompute) competition_standings. It imports nothing from
 * shared-round-submit.ts, useSharedRound.ts or round-mirror.ts, adds no
 * trigger, and never touches api/golf/** or api/group-posts/**. The rounds
 * it reads were written by the mirror exactly as they are today.
 *
 * Provenance: a synced result is `self_reported` (the member posted it);
 * `confirmGolfContest` promotes to `league_verified` with `confirmed_by`.
 * A sync never overwrites a league_verified or imported row (the
 * no-silent-downgrade rule — canOverwriteProvenance with participant
 * authority), so a manager's manual entry or confirmation always wins.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATALOG_ROW_COLUMNS, type CatalogRow } from '@/lib/golf/course-catalog';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';
import { canOverwriteProvenance, type ResultProvenance } from '@/lib/orgs/provenance';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';
import { recomputeStandingsBestEffort } from './standings';
import {
  buildResultPayload,
  matchCourseIds,
  pickRound,
  qualifyRound,
  ratingForRound,
  scoreForRule,
  type CourseRatingRow,
  type GolfPick,
  type GolfRule,
  type HoleRow,
  type RoundRow,
} from './golf-league';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[GOLF LEAGUE]';
const HOLE_BATCH_ROUNDS = 55; // 55 × 18 = 990 < PostgREST's 1000-row cap

export interface SyncSkip {
  entryId: string;
  profileId: string;
  reason: string;
}
export interface SyncReport {
  contestId: string;
  synced: number;
  kept: number;
  skipped: SyncSkip[];
  /** A contest-level reason nothing could sync (no course link, no window…). */
  blocked?: string;
}

interface ContestRow {
  id: string;
  competition_id: string;
  status: string;
  venue_id: string | null;
  holes: number | null;
  play_from: string | null;
  play_to: string | null;
}
interface CompetitionRow {
  id: string;
  sport_key: string;
  format: string;
  status: string;
  scoring_rule: string | null;
  config: Record<string, unknown> | null;
  league_id: string | null;
  club_id: string | null;
}

async function loadContest(
  admin: Admin,
  contestId: string
): Promise<{ contest: ContestRow; competition: CompetitionRow } | null> {
  const { data: contest, error } = await admin
    .from('contests')
    .select('id, competition_id, status, venue_id, holes, play_from, play_to')
    .eq('id', contestId)
    .maybeSingle();
  if (error || !contest) return null;
  const { data: competition } = await admin
    .from('competitions')
    .select('id, sport_key, format, status, scoring_rule, config, league_id, club_id')
    .eq('id', contest.competition_id)
    .maybeSingle();
  if (!competition) return null;
  return { contest: contest as ContestRow, competition: competition as CompetitionRow };
}

function golfRule(scoringRule: string | null): GolfRule {
  return scoringRule === 'golf_net' || scoringRule === 'golf_gross' ? scoringRule : 'stroke_total';
}
function golfPick(config: Record<string, unknown> | null): GolfPick {
  const pick = (config?.golf as { pick?: unknown } | undefined)?.pick;
  return pick === 'best' ? 'best' : 'first';
}

/** Fill one league round from the members' posted rounds. */
export async function syncGolfContest(admin: Admin, contestId: string): Promise<SyncReport> {
  const report: SyncReport = { contestId, synced: 0, kept: 0, skipped: [] };
  const loaded = await loadContest(admin, contestId);
  if (!loaded) return { ...report, blocked: 'round not found' };
  const { contest, competition } = loaded;
  if (competition.sport_key !== 'golf' || competition.format !== 'leaderboard') {
    return { ...report, blocked: 'not a golf league' };
  }
  if (contest.status === 'canceled') return { ...report, blocked: 'round canceled' };
  if (!contest.holes || !contest.play_from || !contest.play_to) {
    return { ...report, blocked: 'round has no hole count or play window' };
  }
  if (!contest.venue_id) return { ...report, blocked: 'round has no course' };

  // The course(s): the venue's golf link → catalog rows (club = every section).
  const { data: venue } = await admin
    .from('venues')
    .select('id, golf_club_id, golf_course_id')
    .eq('id', contest.venue_id)
    .maybeSingle();
  const link = {
    golfClubId: (venue?.golf_club_id ?? null) as string | null,
    golfCourseId: (venue?.golf_course_id ?? null) as string | null,
  };
  if (!link.golfClubId && !link.golfCourseId) {
    return { ...report, blocked: 'the venue has no golf course linked' };
  }
  const courseRes = link.golfClubId
    ? await admin.from('golf_courses').select(CATALOG_ROW_COLUMNS).eq('club_id', link.golfClubId).limit(40)
    : await admin.from('golf_courses').select(CATALOG_ROW_COLUMNS).eq('id', link.golfCourseId as string);
  const courseRows = ((courseRes.data ?? []) as unknown as CatalogRow[]).map(
    (r): CourseRatingRow => ({
      id: r.id,
      club_id: r.club_id ?? null,
      section_kind: r.section_kind ?? null,
      total_par: r.total_par,
      holes_count: r.holes_count,
      course_rating: r.course_rating ?? null,
      slope_rating: r.slope_rating ?? null,
    })
  );
  const courseIds = matchCourseIds(link, courseRows);
  if (courseIds.size === 0) return { ...report, blocked: 'the linked course is not in the catalog' };
  const courseById = new Map(courseRows.map(c => [c.id, c]));

  // Participants → entries → profiles.
  const { data: participants } = await admin
    .from('contest_participants')
    .select('id, entry_id, competition_entries!inner(profile_id, status)')
    .eq('contest_id', contest.id)
    .limit(500);
  const members = (participants ?? [])
    .map(p => {
      const e = p.competition_entries as { profile_id: string | null; status: string } | { profile_id: string | null; status: string }[];
      const entry = Array.isArray(e) ? e[0] : e;
      return { participantId: p.id as string, entryId: p.entry_id as string, profileId: entry?.profile_id ?? null };
    })
    .filter((m): m is { participantId: string; entryId: string; profileId: string } => !!m.profileId);
  if (members.length === 0) return report;

  // Existing results — never downgrade a verified/imported row.
  const { data: existing } = await admin
    .from('contest_results')
    .select('participant_id, provenance')
    .in('participant_id', members.map(m => m.participantId));
  const existingProvenance = new Map(
    (existing ?? []).map(r => [r.participant_id as string, r.provenance as ResultProvenance])
  );

  // ONE rounds read for every member in the window at the course(s).
  const { data: roundsData } = await admin
    .from('golf_rounds')
    .select(
      'id, profile_id, date, course_id, tee, holes, gross_score, course_rating, slope_rating, par, round_type, is_complete, created_at, group_post_id'
    )
    .in('profile_id', members.map(m => m.profileId))
    .in('course_id', [...courseIds])
    .gte('date', contest.play_from)
    .lte('date', contest.play_to)
    .eq('is_complete', true)
    .order('created_at', { ascending: true })
    .limit(500);
  const rounds = (roundsData ?? []) as RoundRow[];
  const holesByRound = new Map<string, HoleRow[]>();
  const roundIds = rounds.map(r => r.id);
  for (let i = 0; i < roundIds.length; i += HOLE_BATCH_ROUNDS) {
    const { data: holes } = await admin
      .from('golf_holes')
      .select('round_id, hole_number, strokes')
      .in('round_id', roundIds.slice(i, i + HOLE_BATCH_ROUNDS));
    for (const h of holes ?? []) {
      if (!holesByRound.has(h.round_id)) holesByRound.set(h.round_id, []);
      holesByRound.get(h.round_id)!.push({ hole_number: h.hole_number, strokes: h.strokes });
    }
  }
  const roundsByProfile = new Map<string, RoundRow[]>();
  for (const r of rounds) {
    if (!roundsByProfile.has(r.profile_id)) roundsByProfile.set(r.profile_id, []);
    roundsByProfile.get(r.profile_id)!.push(r);
  }

  const rule = golfRule(competition.scoring_rule);
  const pick = golfPick(competition.config);
  const spec = { holes: contest.holes as 9 | 18, playFrom: contest.play_from, playTo: contest.play_to };
  const indexCache = new Map<string, number | null>();
  const upserts: Record<string, unknown>[] = [];

  for (const m of members) {
    const prior = existingProvenance.get(m.participantId);
    if (prior && !canOverwriteProvenance(prior, 'participant')) {
      report.kept += 1;
      continue;
    }
    const candidates: { round: RoundRow; holes: number; holesSource: 'card' | 'declared'; created_at: string; score: number }[] = [];
    let lastReason = 'no completed round in the window at this course';
    for (const round of roundsByProfile.get(m.profileId) ?? []) {
      const q = qualifyRound(round, holesByRound.get(round.id) ?? [], spec, courseIds);
      if (!q.ok) {
        lastReason = q.reason;
        continue;
      }
      candidates.push({
        round,
        holes: q.holes,
        holesSource: q.holesSource,
        created_at: round.created_at,
        score: round.gross_score as number,
      });
    }
    const chosen = pickRound(candidates, pick);
    if (!chosen) {
      report.skipped.push({ entryId: m.entryId, profileId: m.profileId, reason: lastReason });
      continue;
    }
    const courseRow = chosen.round.course_id ? (courseById.get(chosen.round.course_id) ?? null) : null;
    const pair = rule === 'golf_net' ? ratingForRound(chosen.round, courseRow, chosen.holes) : null;
    let index: number | null = null;
    if (rule === 'golf_net' && pair) {
      if (!indexCache.has(m.profileId)) {
        try {
          const hc = await fetchHandicapComputation(m.profileId, admin);
          indexCache.set(m.profileId, hc.current?.index ?? null);
        } catch (error) {
          console.warn(`${TAG} handicap read failed (gross only):`, error);
          indexCache.set(m.profileId, null);
        }
      }
      index = indexCache.get(m.profileId) ?? null;
    }
    const par =
      chosen.round.par ??
      (chosen.holes === 9 && courseRow?.section_kind === 'nine' ? courseRow.total_par : null) ??
      (chosen.holes === 18 ? (courseRow?.total_par ?? null) : null);
    const payload = buildResultPayload({
      round: chosen.round,
      holes: chosen.holes,
      holesSource: chosen.holesSource,
      pair,
      index,
      par,
    });
    upserts.push({
      contest_id: contest.id,
      participant_id: m.participantId,
      score: scoreForRule(rule, payload),
      payload,
      provenance: 'self_reported',
      entered_by: m.profileId,
    });
    report.synced += 1;
  }

  if (upserts.length > 0) {
    const { error } = await admin
      .from('contest_results')
      .upsert(upserts, { onConflict: 'participant_id' });
    if (error) {
      console.error(`${TAG} results upsert error:`, error);
      return { ...report, synced: 0, blocked: 'failed to write the results' };
    }
    await recomputeStandingsBestEffort(admin, competition.id);
    await revalidateOrgSiteForCompetition(admin, competition.id);
  }
  return report;
}

/** The manager confirms a round: self_reported → league_verified, the
 *  round completes (standings count it), the site refreshes. */
export async function confirmGolfContest(
  admin: Admin,
  contestId: string,
  confirmedBy: string
): Promise<NextResponse> {
  const loaded = await loadContest(admin, contestId);
  if (!loaded) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
  const { contest, competition } = loaded;
  const { error } = await admin
    .from('contest_results')
    .update({ provenance: 'league_verified', confirmed_by: confirmedBy })
    .eq('contest_id', contest.id)
    .eq('provenance', 'self_reported');
  if (error) {
    console.error(`${TAG} confirm error:`, error);
    return NextResponse.json({ error: 'Failed to confirm the round' }, { status: 500 });
  }
  if (contest.status !== 'completed') {
    await admin.from('contests').update({ status: 'completed' }).eq('id', contest.id);
  }
  await recomputeStandingsBestEffort(admin, competition.id);
  await revalidateOrgSiteForCompetition(admin, competition.id);
  return NextResponse.json({ ok: true, contestId: contest.id });
}

/** Sync every open (or recently closed) round of one competition. */
export async function syncGolfCompetition(
  admin: Admin,
  competitionId: string
): Promise<{ reports: SyncReport[] }> {
  const { data: contests } = await admin
    .from('contests')
    .select('id')
    .eq('competition_id', competitionId)
    .not('holes', 'is', null)
    .neq('status', 'canceled')
    .limit(100);
  const reports: SyncReport[] = [];
  for (const c of contests ?? []) reports.push(await syncGolfContest(admin, c.id as string));
  return { reports };
}

/** Route core: one contest or the whole competition. */
export async function golfSyncPOST(
  admin: Admin,
  competitionId: string,
  contestId: string | null
): Promise<NextResponse> {
  if (contestId) {
    const loaded = await loadContest(admin, contestId);
    if (!loaded || loaded.contest.competition_id !== competitionId) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }
    return NextResponse.json({ reports: [await syncGolfContest(admin, contestId)] });
  }
  return NextResponse.json(await syncGolfCompetition(admin, competitionId));
}

/** The daily cron phase: keep open windows fresh (plus a 3-day grace for
 *  late posts) and complete windows that closed more than 3 days ago —
 *  their self_reported rows stay self_reported (the chip says so) until a
 *  manager confirms. Bounded; never throws. */
export async function runGolfLeagueSync(
  admin: Admin
): Promise<{ contests: number; synced: number; completed: number }> {
  const out = { contests: 0, synced: 0, completed: 0 };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const grace = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const { data: open } = await admin
      .from('contests')
      .select('id, play_to, status, competitions!inner(sport_key, format, status)')
      .not('holes', 'is', null)
      .lte('play_from', today)
      .gte('play_to', grace)
      .in('status', ['scheduled', 'in_progress'])
      .eq('competitions.sport_key', 'golf')
      .eq('competitions.format', 'leaderboard')
      .eq('competitions.status', 'active')
      .limit(100);
    for (const c of open ?? []) {
      out.contests += 1;
      const r = await syncGolfContest(admin, c.id as string);
      out.synced += r.synced;
    }
    const { data: stale } = await admin
      .from('contests')
      .select('id, competition_id, competitions!inner(sport_key, format)')
      .not('holes', 'is', null)
      .lt('play_to', grace)
      .in('status', ['scheduled', 'in_progress'])
      .eq('competitions.sport_key', 'golf')
      .eq('competitions.format', 'leaderboard')
      .limit(100);
    for (const c of stale ?? []) {
      await syncGolfContest(admin, c.id as string);
      const { error } = await admin.from('contests').update({ status: 'completed' }).eq('id', c.id);
      if (!error) {
        out.completed += 1;
        await recomputeStandingsBestEffort(admin, c.competition_id as string);
        await revalidateOrgSiteForCompetition(admin, c.competition_id as string);
      }
    }
  } catch (error) {
    console.error(`${TAG} cron phase failed:`, error);
  }
  return out;
}
