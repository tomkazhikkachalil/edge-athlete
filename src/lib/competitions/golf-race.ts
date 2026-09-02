// ── The points race (phase 8 P1) — the PURE engine ──────────────────────────
// A FedEx-style season told week by week: each completed round's points
// (golf-points.ts, awarded over the FULL field — the standings recompute's
// truth), the running total, the rank after every week and the movement
// into the latest one. Nothing is stored (competition_standings is
// rewritten whole); the race is derived from contest_results at read time,
// from the raw rows the public standings reader already loads.
//
// People rule: supervised entrants are OMITTED from the rows AFTER the
// awarding, so their places still count for everyone else (a rank gap,
// never a different point total than the table). Node-tested.

import { awardRoundPoints, type PointsPreset } from './golf-points';

export interface RaceContestRaw {
  id: string;
  round: string | null;
  status: string;
  play_from: string;
}
export interface RaceParticipantRaw {
  id: string;
  contest_id: string;
  entry_id: string;
}
export interface RaceResultRaw {
  contest_id: string;
  participant_id: string;
  score: number | null;
}

export interface RaceWeek {
  contestId: string;
  round: string | null;
  playFrom: string;
}

export interface RaceRow {
  entryId: string;
  entrant_name: string;
  /** P2: the public profile's handle — a link on public surfaces. */
  playerHandle?: string;
  /** Points per week (null = no scored round that week). */
  weekly: (number | null)[];
  /** Running total after each week. */
  cumulative: number[];
  /** Rank after each week (ties share); null before the first scored round. */
  rank: (number | null)[];
  total: number;
  /** Places gained (+) or lost (−) into the latest week; null with fewer
   *  than two ranked weeks. */
  movement: number | null;
}

export interface PointsRace {
  weeks: RaceWeek[];
  rows: RaceRow[];
}

export interface BuildPointsRaceInput {
  contests: RaceContestRaw[];
  participants: RaceParticipantRaw[];
  results: RaceResultRaw[];
  preset: PointsPreset;
  entryName: Map<string, string>;
  omittedEntries: Set<string>;
  /** P2 hook: handles for public profiles, by entry id. */
  entryHandle?: Map<string, string>;
}

function rankByTotal(totals: Map<string, number>, ranked: Set<string>): Map<string, number> {
  const ids = [...ranked].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || (a < b ? -1 : 1));
  const out = new Map<string, number>();
  let lastTotal: number | null = null;
  let lastRank = 0;
  ids.forEach((id, i) => {
    const t = totals.get(id) ?? 0;
    const rank = t === lastTotal ? lastRank : i + 1;
    lastTotal = t;
    lastRank = rank;
    out.set(id, rank);
  });
  return out;
}

/** The race, or null when no round has completed yet. */
export function buildPointsRace(input: BuildPointsRaceInput): PointsRace | null {
  const completed = input.contests
    .filter(c => c.status === 'completed' && !!c.play_from)
    .sort((a, b) => (a.play_from < b.play_from ? -1 : a.play_from > b.play_from ? 1 : (a.round ?? '').localeCompare(b.round ?? '')));
  if (completed.length === 0) return null;

  const participantEntry = new Map(input.participants.map(p => [p.id, p.entry_id]));
  const resultsByContest = new Map<string, RaceResultRaw[]>();
  for (const r of input.results) {
    if (!resultsByContest.has(r.contest_id)) resultsByContest.set(r.contest_id, []);
    resultsByContest.get(r.contest_id)!.push(r);
  }

  // Every entrant who took part in a completed week (the field).
  const entryIds = new Set<string>();
  for (const c of completed) {
    for (const p of input.participants) if (p.contest_id === c.id) entryIds.add(p.entry_id);
  }

  const weekly = new Map<string, (number | null)[]>();
  const cumulative = new Map<string, number[]>();
  const ranks = new Map<string, (number | null)[]>();
  for (const id of entryIds) {
    weekly.set(id, []);
    cumulative.set(id, []);
    ranks.set(id, []);
  }
  const totals = new Map<string, number>([...entryIds].map(id => [id, 0]));
  const ranked = new Set<string>();

  for (const c of completed) {
    const field = (resultsByContest.get(c.id) ?? [])
      .map(r => ({ entry_id: participantEntry.get(r.participant_id) ?? '', score: r.score }))
      .filter(f => entryIds.has(f.entry_id));
    // The FULL field — supervised rows included — exactly as the recompute.
    const awards = new Map(awardRoundPoints(field, input.preset).map(a => [a.entry_id, a.points]));
    for (const id of entryIds) {
      const pts = awards.get(id);
      weekly.get(id)!.push(pts ?? null);
      if (pts !== undefined) {
        totals.set(id, Math.round(((totals.get(id) ?? 0) + pts) * 100) / 100);
        ranked.add(id);
      }
      cumulative.get(id)!.push(totals.get(id) ?? 0);
    }
    const rankNow = rankByTotal(totals, ranked);
    for (const id of entryIds) ranks.get(id)!.push(rankNow.get(id) ?? null);
  }

  const rows: RaceRow[] = [...entryIds]
    .filter(id => !input.omittedEntries.has(id))
    .map(id => {
      const r = ranks.get(id)!;
      const last = r[r.length - 1];
      const prior = r.length >= 2 ? r[r.length - 2] : null;
      return {
        entryId: id,
        entrant_name: input.entryName.get(id) ?? 'Athlete',
        ...(input.entryHandle?.get(id) ? { playerHandle: input.entryHandle.get(id) } : {}),
        weekly: weekly.get(id)!,
        cumulative: cumulative.get(id)!,
        rank: r,
        total: totals.get(id) ?? 0,
        movement: last !== null && prior !== null ? prior - last : null,
      };
    })
    .sort((a, b) => {
      const ra = a.rank[a.rank.length - 1];
      const rb = b.rank[b.rank.length - 1];
      if (ra === null && rb === null) return a.entrant_name.localeCompare(b.entrant_name);
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra - rb || a.entrant_name.localeCompare(b.entrant_name);
    });

  return {
    weeks: completed.map(c => ({ contestId: c.id, round: c.round, playFrom: c.play_from })),
    rows,
  };
}
