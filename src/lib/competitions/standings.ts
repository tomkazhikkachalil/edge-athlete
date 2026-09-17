// ── Standings recompute — the materialized half (phase 2 R3) ────────────────
// Tom's decision: competition_standings is a MATERIALIZED table, rewritten
// whole per competition on every result write / contest status change /
// entry change. The hook sites call this BEST-EFFORT (warn-and-continue —
// a standings failure never fails the triggering write; the admin repair
// route and the next write both heal drift). Reads are chunked ≤500 (the
// PostgREST 1000-row-cap lesson) even though a season is far smaller —
// the §12 scale risk is bounded HERE, not at the callers.

import { computeBracketStandings, type BracketContestRow } from './bracket-draw';
import { deriveContestOutcome } from './contest-outcome';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awardRoundPoints, parseGolfPointsConfig } from './golf-points';
import {
  computeFixtureStandings,
  computeLeaderboardStandings,
  resolveFixtureRule,
  resolveLeaderboardRule,
  type FixtureContestInput,
  type LeaderboardContestInput,
} from './scoring';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[STANDINGS]';
const CHUNK = 500;

async function chunkedIn<T>(
  admin: Admin,
  table: string,
  select: string,
  col: string,
  ids: string[]
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await admin.from(table).select(select).in(col, ids.slice(i, i + CHUNK));
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** Full-competition rewrite: compute → upsert by (competition, entry) →
 *  prune rows for departed entries. Returns row count, or null on any
 *  failure (already logged). */
/** The finite-number keys of a result payload (shape-blind jsonb). */
function numericKeys(payload: Record<string, unknown> | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export async function recomputeStandings(
  admin: Admin,
  competitionId: string
): Promise<number | null> {
  try {
    const { data: comp } = await admin
      .from('competitions')
      .select('id, format, sport_key, scoring_rule, config')
      .eq('id', competitionId)
      .maybeSingle();
    if (!comp) return null;
    // Fixture + leaderboard + bracket (track 2 PR 3) are the live engines; meet defers to PR 7.
    if (comp.format !== 'fixture' && comp.format !== 'leaderboard' && comp.format !== 'bracket') return null;

    const { data: entries } = await admin
      .from('competition_entries')
      .select('id, status')
      .eq('competition_id', competitionId);
    const entryIds = (entries ?? []).filter(e => e.status === 'approved').map(e => e.id as string);

    const { data: contests } = await admin
      .from('contests')
      .select('id, status')
      .eq('competition_id', competitionId)
      .limit(1000);
    const contestIds = (contests ?? []).map(c => c.id as string);
    const statusOf = new Map((contests ?? []).map(c => [c.id, c.status as string]));

    const participants = await chunkedIn<{
      id: string;
      contest_id: string;
      entry_id: string;
    }>(admin, 'contest_participants', 'id, contest_id, entry_id', 'contest_id', contestIds);
    const results = await chunkedIn<{
      participant_id: string;
      contest_id: string;
      score: number | null;
      payload: Record<string, unknown> | null;
    }>(admin, 'contest_results', 'participant_id, contest_id, score, payload', 'contest_id', contestIds);
    const scoreByParticipant = new Map(results.map(r => [r.participant_id, r.score]));
    // G1: numeric payload keys ride along as per-contest stats (golf gross).
    const statsByParticipant = new Map(
      results.map(r => [r.participant_id, numericKeys(r.payload)])
    );

    const sidesByContest = new Map<
      string,
      { entry_id: string; score: number | null; stats: Record<string, number> }[]
    >();
    for (const p of participants) {
      if (!sidesByContest.has(p.contest_id)) sidesByContest.set(p.contest_id, []);
      sidesByContest.get(p.contest_id)!.push({
        entry_id: p.entry_id,
        score: scoreByParticipant.get(p.id) ?? null,
        stats: statsByParticipant.get(p.id) ?? {},
      });
    }
    let rows;
    if (comp.format === 'bracket') {
      // The progression over the staged contests (218). A pre-218 database (42703) → skipped, never a throw.
      const staged = await readBracketRows(admin, competitionId, comp.sport_key as string, comp.scoring_rule as string | null);
      if (!staged) return null;
      rows = computeBracketStandings(entryIds, staged);
    } else if (comp.format === 'fixture') {
      const contestInputs: FixtureContestInput[] = contestIds.map(id => ({
        status: statusOf.get(id) ?? 'scheduled',
        sides: sidesByContest.get(id) ?? [],
      }));
      const rule = resolveFixtureRule(comp.sport_key as string, comp.scoring_rule as string | null);
      rows = computeFixtureStandings(entryIds, contestInputs, rule);
    } else {
      const rule = resolveLeaderboardRule(
        comp.sport_key as string,
        comp.scoring_rule as string | null
      );
      // C6: a points league — each round's STROKES become POINTS by
      // finishing position (ties share), and a win rides as a stat. The
      // stored score stays strokes; points exist only in this table.
      const pointsPreset = rule.key === 'golf_points' ? parseGolfPointsConfig(comp.config).preset : null;
      const contestInputs: LeaderboardContestInput[] = contestIds.map(id => {
        const sides = sidesByContest.get(id) ?? [];
        if (!pointsPreset) return { status: statusOf.get(id) ?? 'scheduled', scores: sides };
        const awards = new Map(awardRoundPoints(sides, pointsPreset).map(a => [a.entry_id, a]));
        return {
          status: statusOf.get(id) ?? 'scheduled',
          scores: sides.map(side => {
            const award = awards.get(side.entry_id);
            return {
              entry_id: side.entry_id,
              score: award ? award.points : null,
              stats: { ...side.stats, win: award && award.position === 1 ? 1 : 0 },
            };
          }),
        };
      });
      rows = computeLeaderboardStandings(entryIds, contestInputs, rule);
    }

    if (rows.length) {
      const { error: upsertError } = await admin.from('competition_standings').upsert(
        rows.map(r => ({
          competition_id: competitionId,
          entry_id: r.entry_id,
          rank: r.rank,
          points: r.points,
          played: r.played,
          stats: r.stats,
          computed_at: new Date().toISOString(),
        })),
        { onConflict: 'competition_id,entry_id' }
      );
      if (upsertError) {
        console.error(`${TAG} upsert failed:`, upsertError);
        return null;
      }
    }
    // Prune departed entries' rows.
    let prune = admin.from('competition_standings').delete().eq('competition_id', competitionId);
    if (rows.length) {
      prune = prune.not('entry_id', 'in', `(${rows.map(r => r.entry_id).join(',')})`);
    }
    const { error: pruneError } = await prune;
    if (pruneError) console.warn(`${TAG} prune failed:`, pruneError.message);
    return rows.length;
  } catch (e) {
    console.error(`${TAG} recompute failed:`, e);
    return null;
  }
}

/** The bracket's contests as the pure engine reads them: sides, the one ranking rule's winner, whether any result exists. Null on a pre-218 database. */
export async function readBracketRows(admin: Admin, competitionId: string, sportKey: string, scoringRule: string | null): Promise<BracketContestRow[] | null> {
  const { data: contests, error } = await admin.from('contests').select('id, status, stage, slot').eq('competition_id', competitionId).not('stage', 'is', null).limit(1000);
  if (error) {
    if (error.code !== '42703') console.warn(`${TAG} bracket contests read failed:`, error.message);
    return null;
  }
  const ids = (contests ?? []).map(c => c.id as string);
  const participants = await chunkedIn<{ id: string; contest_id: string; entry_id: string; side: 'home' | 'away' | null; start_position: number | null }>(admin, 'contest_participants', 'id, contest_id, entry_id, side, start_position', 'contest_id', ids);
  const results = await chunkedIn<{ participant_id: string; contest_id: string; score: number | null; payload: Record<string, unknown> | null }>(admin, 'contest_results', 'participant_id, contest_id, score, payload', 'contest_id', ids);
  const resultBy = new Map(results.map(r => [r.participant_id, r]));
  return (contests ?? []).map(c => {
    const parts = participants.filter(p => p.contest_id === c.id);
    const outcome = deriveContestOutcome({
      format: 'bracket', sportKey, scoringRule, status: c.status as string, stage: c.stage as number, slot: c.slot as number,
      participants: parts.map(p => ({ participantId: p.id, entryId: p.entry_id, side: p.side, startPosition: p.start_position, name: '', score: resultBy.get(p.id)?.score ?? null, payload: resultBy.get(p.id)?.payload ?? null })),
    });
    const home = parts.find(p => p.side === 'home')?.entry_id ?? null;
    const away = parts.find(p => p.side === 'away')?.entry_id ?? null;
    return { id: c.id as string, stage: c.stage as number, slot: c.slot as number, status: c.status as string, home, away, winnerEntryId: outcome.kind === 'bracket' ? outcome.winnerEntryId : null, hasResult: parts.some(p => resultBy.has(p.id)) };
  });
}

/** The hook-site wrapper: never throws, never fails the caller. */
export async function recomputeStandingsBestEffort(
  admin: Admin,
  competitionId: string
): Promise<void> {
  const count = await recomputeStandings(admin, competitionId);
  if (count === null) console.warn(`${TAG} best-effort recompute skipped/failed for ${competitionId}`);
}
