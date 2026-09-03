// ── The season wrap (phase 8 P6) — the PURE engine ──────────────────────────
// When every windowed week of a golf league has closed, the standings page
// gets a "Season complete" card: the champion, the runner-up, the most
// wins, the best round. Derived from the public standings rows and the
// public weeks (the same masking and omission), never stored; the console
// announces it through the announce rails. Node-tested.

import type { PublicStandingRow } from './public-standings';
import type { PublicGolfWeek } from './golf-weeks';

export interface SeasonSummaryPerson {
  name: string;
  playerHandle?: string;
}

export interface SeasonSummary {
  weeksPlayed: number;
  champion: SeasonSummaryPerson & { points: number | null };
  runnerUp: (SeasonSummaryPerson & { points: number | null }) | null;
  mostWins: (SeasonSummaryPerson & { wins: number }) | null;
  bestRound: (SeasonSummaryPerson & { gross: number; round: string | null }) | null;
}

export interface BuildSeasonSummaryInput {
  weeks: PublicGolfWeek[];
  rows: PublicStandingRow[];
  /** The ROUND rule (golf_net / golf_gross / stroke_total) — decides the
   *  week's winner when no points are awarded. */
  scoringRule: string | null;
}

/** Null until every windowed week is closed (canceled ones don't count)
 *  and at least one week has a result. */
export function buildSeasonSummary(input: BuildSeasonSummaryInput): SeasonSummary | null {
  const weeks = input.weeks.filter(w => w.status !== 'canceled');
  if (weeks.length === 0) return null;
  if (weeks.some(w => w.state !== 'closed' && w.status !== 'completed')) return null;
  const played = weeks.filter(w => w.results.length > 0);
  if (played.length === 0) return null;
  const ranked = input.rows.filter(r => r.points !== null);
  if (ranked.length === 0) return null;

  const sorted = [...ranked].sort((a, b) => a.rank - b.rank || a.entrant_name.localeCompare(b.entrant_name));
  const person = (r: { entrant_name: string; playerHandle?: string }): SeasonSummaryPerson => ({
    name: r.entrant_name,
    ...(r.playerHandle ? { playerHandle: r.playerHandle } : {}),
  });
  const champion = { ...person(sorted[0]), points: sorted[0].points };
  const runnerUp = sorted[1] && sorted[1].rank !== sorted[0].rank ? { ...person(sorted[1]), points: sorted[1].points } : sorted[1] ? { ...person(sorted[1]), points: sorted[1].points } : null;

  // Wins: the week's top points, or (no points) the lowest rule score.
  const isNet = input.scoringRule === 'golf_net';
  const wins = new Map<string, { person: SeasonSummaryPerson; wins: number }>();
  let best: (SeasonSummaryPerson & { gross: number; round: string | null }) | null = null;
  for (const w of played) {
    const hasPoints = w.results.some(r => typeof r.points === 'number');
    let top: number | null = null;
    for (const r of w.results) {
      const v = hasPoints ? (typeof r.points === 'number' ? r.points : null) : isNet ? r.net : r.gross;
      if (v === null) continue;
      if (top === null || (hasPoints ? v > top : v < top)) top = v;
    }
    for (const r of w.results) {
      const v = hasPoints ? (typeof r.points === 'number' ? r.points : null) : isNet ? r.net : r.gross;
      if (v !== null && v === top) {
        const cur = wins.get(r.entrant_name) ?? { person: person(r), wins: 0 };
        cur.wins += 1;
        wins.set(r.entrant_name, cur);
      }
      if (r.gross !== null && (best === null || r.gross < best.gross)) {
        best = { ...person(r), gross: r.gross, round: w.round };
      }
    }
  }
  const mostWins = [...wins.values()].sort((a, b) => b.wins - a.wins || a.person.name.localeCompare(b.person.name))[0] ?? null;

  return {
    weeksPlayed: played.length,
    champion,
    runnerUp,
    mostWins: mostWins ? { ...mostWins.person, wins: mostWins.wins } : null,
    bestRound: best,
  };
}

/** The announcement copy (member-facing bells + the site notice). */
export function seasonAnnouncement(competitionName: string, s: SeasonSummary): { title: string; message: string } {
  const pts = s.champion.points !== null ? ` with ${s.champion.points} pts` : '';
  const parts = [
    `${s.champion.name} takes the ${competitionName} title${pts} over ${s.weeksPlayed} week${s.weeksPlayed === 1 ? '' : 's'}.`,
    s.runnerUp ? `Runner-up: ${s.runnerUp.name}${s.runnerUp.points !== null ? ` (${s.runnerUp.points} pts)` : ''}.` : null,
    s.mostWins ? `Most wins: ${s.mostWins.name} (${s.mostWins.wins}).` : null,
    s.bestRound ? `Best round: ${s.bestRound.name}, ${s.bestRound.gross}${s.bestRound.round ? ` in ${s.bestRound.round}` : ''}.` : null,
  ].filter(Boolean);
  return {
    title: `${competitionName}: ${s.champion.name} wins the season`.slice(0, 80),
    message: parts.join(' ').slice(0, 500),
  };
}
