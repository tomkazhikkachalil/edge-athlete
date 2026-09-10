// ── Contest outcome (Contest Place E1) — the result as a renderable thing ──
// A contest's stored truth is one contest_results row per participant
// (score + adapter payload); "who won", "3–1", "T2" were recomputed by
// every surface that wanted them. This is the ONE derivation: pure,
// node-tested, fed by contest-view.ts and (through it) the in-app contest
// page, the org-site twin and the share card. It reuses the scoring
// registry's rules so a rank here can never disagree with the standings
// table — assignSharedRanks is shared with computeLeaderboardStandings.
//
// Two shapes, one per format the registry accepts (validate.ts's
// COMPETITION_FORMATS_V1): a fixture is two sides and a scoreline; a
// leaderboard is ranked rows. Bracket / meet are out of scope (parked).

import {
  assignSharedRanks,
  resolveFixtureRule,
  resolveLeaderboardRule,
  type StandingsColumn,
} from './scoring';

export interface OutcomeParticipantInput {
  participantId: string;
  entryId: string;
  side: 'home' | 'away' | null;
  startPosition: number | null;
  /** Already display-safe (masked where the name rule says so). */
  name: string;
  score: number | null;
  payload: Record<string, unknown> | null;
}

export interface OutcomeSide {
  participantId: string;
  entryId: string;
  name: string;
  score: number | null;
}

export interface OutcomeRow {
  participantId: string;
  entryId: string;
  name: string;
  /** null = no result yet (always listed after the scored rows). */
  rank: number | null;
  score: number | null;
  /** Numeric payload values the rule's columns name (gross beside net…). */
  stats: Record<string, number>;
}

export type ContestOutcome =
  | {
      kind: 'fixture';
      /** Both sides scored AND the contest is completed. */
      complete: boolean;
      home: OutcomeSide | null;
      away: OutcomeSide | null;
      winnerEntryId: string | null;
      tie: boolean;
      /** "3–1" (home first) once both scores exist; null before. */
      scoreline: string | null;
    }
  | {
      kind: 'leaderboard';
      complete: boolean;
      /** 'asc' = fewer is better (strokes). */
      direction: 'asc' | 'desc';
      /** The score column first, then the rule's stat columns that at least
       *  one row carries. */
      columns: StandingsColumn[];
      rows: OutcomeRow[];
      leaderEntryId: string | null;
    }
  | { kind: 'unscored'; complete: boolean };

export interface OutcomeInput {
  format: string;
  sportKey: string;
  scoringRule: string | null;
  status: string;
  participants: OutcomeParticipantInput[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function deriveContestOutcome(input: OutcomeInput): ContestOutcome {
  const completed = input.status === 'completed';
  if (input.format === 'fixture') return fixtureOutcome(input, completed);
  if (input.format === 'leaderboard') return leaderboardOutcome(input, completed);
  return { kind: 'unscored', complete: completed };
}

function fixtureOutcome(input: OutcomeInput, completed: boolean): ContestOutcome {
  // The registry's rule exists for every fixture sport (default 2-1-0);
  // resolving it here keeps an unknown rule string from being a page error.
  resolveFixtureRule(input.sportKey, input.scoringRule);
  const byStart = [...input.participants].sort(
    (a, b) => (a.startPosition ?? 0) - (b.startPosition ?? 0)
  );
  const homeIn = input.participants.find(p => p.side === 'home') ?? byStart[0] ?? null;
  const awayIn =
    input.participants.find(p => p.side === 'away') ??
    byStart.find(p => p !== homeIn) ??
    null;
  const side = (p: OutcomeParticipantInput | null): OutcomeSide | null =>
    p ? { participantId: p.participantId, entryId: p.entryId, name: p.name, score: p.score } : null;
  const home = side(homeIn);
  const away = side(awayIn);
  const scored = home?.score != null && away?.score != null;
  let winnerEntryId: string | null = null;
  let tie = false;
  if (scored) {
    if (home!.score! > away!.score!) winnerEntryId = home!.entryId;
    else if (home!.score! < away!.score!) winnerEntryId = away!.entryId;
    else tie = true;
  }
  return {
    kind: 'fixture',
    complete: completed && scored,
    home,
    away,
    winnerEntryId,
    tie,
    scoreline: scored ? `${home!.score}–${away!.score}` : null,
  };
}

function leaderboardOutcome(input: OutcomeInput, completed: boolean): ContestOutcome {
  const rule = resolveLeaderboardRule(input.sportKey, input.scoringRule);
  const statKeys = [
    ...new Set([
      ...rule.columns.map(c => c.key).filter(k => k !== 'played' && k !== 'points'),
      ...(rule.sumStats ?? []),
    ]),
  ];
  const rowsIn = input.participants.map(p => {
    const stats: Record<string, number> = {};
    for (const key of statKeys) {
      const v = p.payload?.[key];
      if (isNum(v)) stats[key] = v;
    }
    return { p, stats };
  });
  // Scored rows by the rule's direction, unscored last; name then id break
  // ties deterministically (the standings twin breaks on id only, but a
  // contest page reads better alphabetised inside a tie).
  const sortKey = (score: number | null): number =>
    score == null ? Number.POSITIVE_INFINITY : rule.direction === 'asc' ? score : -score;
  const sorted = [...rowsIn].sort((x, y) => {
    const kx = sortKey(x.p.score);
    const ky = sortKey(y.p.score);
    if (kx !== ky) return kx - ky;
    const byName = x.p.name.localeCompare(y.p.name);
    if (byName !== 0) return byName;
    return x.p.participantId < y.p.participantId ? -1 : 1;
  });
  const scoredCount = sorted.filter(r => r.p.score != null).length;
  const ranks = assignSharedRanks(scoredCount, i => sortKey(sorted[i].p.score));
  const rows: OutcomeRow[] = sorted.map((r, i) => ({
    participantId: r.p.participantId,
    entryId: r.p.entryId,
    name: r.p.name,
    rank: i < scoredCount ? ranks[i] : null,
    score: r.p.score,
    stats: r.stats,
  }));
  const pointsCol = rule.columns.find(c => c.key === 'points');
  const present = new Set(rows.flatMap(r => Object.keys(r.stats)));
  const columns: StandingsColumn[] = [
    { key: 'score', label: pointsCol?.label ?? 'Score', shortLabel: pointsCol?.shortLabel ?? 'SCR' },
    ...rule.columns.filter(c => c.key !== 'played' && c.key !== 'points' && present.has(c.key)),
  ];
  return {
    kind: 'leaderboard',
    complete: completed && scoredCount > 0,
    direction: rule.direction,
    columns,
    rows,
    leaderEntryId: scoredCount > 0 ? rows[0].entryId : null,
  };
}
