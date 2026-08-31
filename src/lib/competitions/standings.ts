// ── Standings recompute — the materialized half (phase 2 R3) ────────────────
// Tom's decision: competition_standings is a MATERIALIZED table, rewritten
// whole per competition on every result write / contest status change /
// entry change. The hook sites call this BEST-EFFORT (warn-and-continue —
// a standings failure never fails the triggering write; the admin repair
// route and the next write both heal drift). Reads are chunked ≤500 (the
// PostgREST 1000-row-cap lesson) even though a season is far smaller —
// the §12 scale risk is bounded HERE, not at the callers.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeFixtureStandings, resolveFixtureRule, type FixtureContestInput } from './scoring';

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
export async function recomputeStandings(
  admin: Admin,
  competitionId: string
): Promise<number | null> {
  try {
    const { data: comp } = await admin
      .from('competitions')
      .select('id, format, sport_key, scoring_rule')
      .eq('id', competitionId)
      .maybeSingle();
    if (!comp) return null;
    // Leaderboard aggregation arrives with R5; fixtures are the v1 engine.
    if (comp.format !== 'fixture') return null;

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
    const results = await chunkedIn<{ participant_id: string; contest_id: string; score: number | null }>(
      admin,
      'contest_results',
      'participant_id, contest_id, score',
      'contest_id',
      contestIds
    );
    const scoreByParticipant = new Map(results.map(r => [r.participant_id, r.score]));

    const sidesByContest = new Map<string, { entry_id: string; score: number | null }[]>();
    for (const p of participants) {
      if (!sidesByContest.has(p.contest_id)) sidesByContest.set(p.contest_id, []);
      sidesByContest.get(p.contest_id)!.push({
        entry_id: p.entry_id,
        score: scoreByParticipant.get(p.id) ?? null,
      });
    }
    const contestInputs: FixtureContestInput[] = contestIds.map(id => ({
      status: statusOf.get(id) ?? 'scheduled',
      sides: sidesByContest.get(id) ?? [],
    }));

    const rule = resolveFixtureRule(comp.sport_key as string, comp.scoring_rule as string | null);
    const rows = computeFixtureStandings(entryIds, contestInputs, rule);

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

/** The hook-site wrapper: never throws, never fails the caller. */
export async function recomputeStandingsBestEffort(
  admin: Admin,
  competitionId: string
): Promise<void> {
  const count = await recomputeStandings(admin, competitionId);
  if (count === null) console.warn(`${TAG} best-effort recompute skipped/failed for ${competitionId}`);
}
