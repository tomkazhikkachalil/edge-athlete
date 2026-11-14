/**
 * One game, counted once (Nov 14 2026 — Tom's rule). Pure, zero imports.
 *
 * An athlete's game can reach the Stats tab three ways: an OFFICIAL line a
 * league or club entered on a contest, a VERIFIED FILM game (a club's or
 * league's fully tagged video), and the athlete's own POST. When two of
 * them are the same game only one counts, by rank:
 *
 *     official  >  film  >  post
 *
 * "The same game" is, in order of certainty:
 *   1. the same contest (an exact link — never overridable);
 *   2. the same date in a sport whose games have two sides (`matchByDate`),
 *      preferring the pair whose opponents read the same — unless the
 *      athlete has said the two are different games (`distinct`).
 * A race or a round is never matched by date (a meet has many races a day).
 *
 * Matching is ONE TO ONE per source: an official line takes at most one
 * post and one film game with it, so a three-game tournament day with one
 * official line and three posts still counts three games. Two film games of
 * one game (a club and a league both filmed it) count once. Posts are never
 * matched against each other, nor official lines (one per contest by the
 * table's own key). A game with no date is matched only by its contest.
 * The loser is never hidden: it comes back with who beat it and why.
 */
export type GameSource = 'official' | 'film' | 'post';

export interface CountableGame {
  /** Unique across sources (e.g. `official:<contest>`, `film:<video>`, `post:<id>`). */
  id: string;
  source: GameSource;
  /** YYYY-MM-DD, or null when unknown. */
  date: string | null;
  contestId?: string | null;
  /** Free text; compared case- and space-insensitively, only to choose between same-date candidates. */
  opponent?: string | null;
}

export type NotCountedReason = 'same_contest' | 'same_date';
export interface CountedGame { id: string; counted: boolean; beatenBy: string | null; reason: NotCountedReason | null }

export const SOURCE_RANK: Readonly<Record<GameSource, number>> = { official: 3, film: 2, post: 1 };

/** The key of an athlete's "these are two different games" — order-free. */
export function distinctKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function countGames(games: readonly CountableGame[], opts: { matchByDate: boolean; distinct?: ReadonlySet<string> } = { matchByDate: false }): Map<string, CountedGame> {
  const out = new Map<string, CountedGame>();
  for (const g of games) if (!out.has(g.id)) out.set(g.id, { id: g.id, counted: true, beatenBy: null, reason: null });
  // Winners first: by rank, then a game with a contest link, then a stable order.
  const order = [...new Map(games.map(g => [g.id, g])).values()].sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || Number(!!b.contestId) - Number(!!a.contestId) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const beat = (loser: CountableGame, winner: CountableGame, reason: NotCountedReason) => out.set(loser.id, { id: loser.id, counted: false, beatenBy: winner.id, reason });
  // Two games tied to two DIFFERENT contests are two games, whatever the date.
  const sameDate = (w: CountableGame, l: CountableGame) => opts.matchByDate && !!w.date && w.date === l.date && !(w.contestId && l.contestId && w.contestId !== l.contestId) && !opts.distinct?.has(distinctKey(w.id, l.id));

  for (const w of order) {
    if (!out.get(w.id)!.counted) continue;
    // What this game can take with it: every lower source, and — for film only — its own.
    const sources: GameSource[] = (['film', 'post'] as const).filter(s => SOURCE_RANK[s] < SOURCE_RANK[w.source] || (s === 'film' && w.source === 'film'));
    for (const s of sources) {
      const open = order.filter(l => l.source === s && l.id !== w.id && out.get(l.id)!.counted);
      const exact = w.contestId ? open.filter(l => l.contestId === w.contestId) : [];
      // Every game of the same contest is that game, however many there are.
      for (const l of exact) beat(l, w, 'same_contest');
      if (exact.length > 0) continue;
      const dated = open.filter(l => sameDate(w, l));
      if (dated.length === 0) continue;
      const wo = norm(w.opponent);
      const pick = (wo && dated.find(l => norm(l.opponent) === wo)) || dated[0];
      beat(pick, w, 'same_date');
    }
  }
  return out;
}
