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
  type LeaderboardScoringRule,
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

/** Track 2: how a knockout tie was settled — carried IN the result payload of the advancing side, never a stored outcome column. */
export const ADVANCE_KINDS = ['shootout', 'extra_time', 'penalties', 'decision', 'forfeit'] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];
export const isAdvanceKind = (v: unknown): v is AdvanceKind => typeof v === 'string' && (ADVANCE_KINDS as readonly string[]).includes(v);
export const ADVANCE_LABEL: Readonly<Record<AdvanceKind, string>> = { shootout: 'won on a shootout', extra_time: 'won in extra time', penalties: 'won on penalties', decision: 'by decision', forfeit: 'by forfeit' };

export interface BracketOutcomeExtra {
  stage: number | null;
  slot: number | null;
  roundName: string | null;
  /** Set when a tied score was settled by the payload's `advance`. */
  advancedBy: AdvanceKind | null;
}

export type ContestOutcome =
  | ({
      kind: 'bracket';
      complete: boolean;
      home: OutcomeSide | null;
      away: OutcomeSide | null;
      winnerEntryId: string | null;
      tie: boolean;
      scoreline: string | null;
    } & BracketOutcomeExtra)
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
  /** Track 2 (218): a bracket contest's place; absent elsewhere. */
  stage?: number | null;
  slot?: number | null;
  roundName?: string | null;
  /** Track 2 PR 7: a meet event's rule — from the sport profile's `meetEvents`, matched by the contest's round label; a meet contest without one is unscored. */
  meetEvent?: MeetEventRule | null;
}

export interface MeetEventRule {
  label: string;
  unit: 's' | 'm';
  direction: 'asc' | 'desc';
}

/** A meet event IS a leaderboard contest with a per-event rule: the mark is the score, ordered by the event's direction (times ascend, distances descend); one column, the mark. */
export function meetLeaderboardRule(ev: MeetEventRule): LeaderboardScoringRule {
  return { key: `meet:${ev.label}`, kind: 'leaderboard', direction: ev.direction, columns: [{ key: 'points', label: `${ev.label} mark`, shortLabel: 'Mark' }], sumStats: [] };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function deriveContestOutcome(input: OutcomeInput): ContestOutcome {
  const completed = input.status === 'completed';
  if (input.format === 'fixture') return fixtureOutcome(input, completed);
  if (input.format === 'bracket') return bracketOutcome(input, completed);
  if (input.format === 'leaderboard') return leaderboardOutcome(input, completed);
  if (input.format === 'meet') return input.meetEvent ? leaderboardOutcome(input, completed, meetLeaderboardRule(input.meetEvent)) : { kind: 'unscored', complete: completed };
  return { kind: 'unscored', complete: completed };
}

/** A bracket contest is the fixture shape; a tied score is settled by the payload's `advance` on exactly one side — else undecided. */
function bracketOutcome(input: OutcomeInput, completed: boolean): ContestOutcome {
  const f = fixtureOutcome(input, completed);
  if (f.kind !== 'fixture') return f;
  let winnerEntryId = f.winnerEntryId;
  let tie = f.tie;
  let advancedBy: AdvanceKind | null = null;
  if (f.tie && f.home && f.away) {
    const adv = (side: OutcomeSide) => {
      const p = input.participants.find(x => x.participantId === side.participantId);
      const v = p?.payload?.advance;
      return isAdvanceKind(v) ? v : null;
    };
    const h = adv(f.home);
    const a = adv(f.away);
    if ((h && !a) || (a && !h)) {
      winnerEntryId = h ? f.home.entryId : f.away.entryId;
      advancedBy = h ?? a;
      tie = false;
    }
  }
  return { kind: 'bracket', complete: completed && !!winnerEntryId, home: f.home, away: f.away, winnerEntryId, tie, scoreline: f.scoreline, stage: input.stage ?? null, slot: input.slot ?? null, roundName: input.roundName ?? null, advancedBy };
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

function leaderboardOutcome(input: OutcomeInput, completed: boolean, ruleOverride?: LeaderboardScoringRule): ContestOutcome {
  const rule = ruleOverride ?? resolveLeaderboardRule(input.sportKey, input.scoringRule);
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
