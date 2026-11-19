// ── Golf's sport profile: Career → Season → Round → Hole (pure) ──────────────
// "One wave", phase 3 (Nov 2026; Tom: every sport gets a profile, golf
// included). Zero imports. Golf does not fit the stat-line payload — its
// numbers are scores against par, not sums — so it has its own rules, the
// same levels and the same promise: a number is a door.
//
//   * a SEASON is the calendar year of the round's date;
//   * a round is SCORED when it is complete and has a gross score;
//   * "to par per 18" puts 9- and 18-hole rounds on one scale;
//   * fairways are asked on par 4s and 5s only; a hole with no answer is
//     not an attempt (never a miss).
//
// Results are never lost (241): a round its owner HID still counts in every
// total here; it is only never LISTED, and never a door, for anyone else.
// The server folds the totals over all rounds and sends the list without
// the hidden ones (golf-profile-server.ts).

export interface GolfHoleRow {
  n: number;
  par: number | null;
  /** The par was estimated from the map's hole length (migration 316). */
  parEst?: true;
  strokes: number | null;
  putts: number | null;
  fairway: boolean | null;
  green: boolean | null;
  penalties: number;
}

export interface GolfRound {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  course: string;
  location: string | null;
  tee: string | null;
  holes: number;
  type: string | null;
  par: number | null;
  gross: number | null;
  complete: boolean;
  /** Hidden from the athlete's page by the athlete: counted, never listed for anyone else. */
  hidden: boolean;
  holeRows: GolfHoleRow[];
}

export type ScoreKind = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double';
export const SCORE_KINDS: ReadonlyArray<{ id: ScoreKind; label: string }> = [
  { id: 'eagle', label: 'Eagles or better' },
  { id: 'birdie', label: 'Birdies' },
  { id: 'par', label: 'Pars' },
  { id: 'bogey', label: 'Bogeys' },
  { id: 'double', label: 'Doubles or worse' },
];

/** What a hole's score is called; null when the hole has no par or no strokes. */
export function scoreKindOf(par: number | null, strokes: number | null): ScoreKind | null {
  if (par === null || strokes === null || par <= 0 || strokes <= 0) return null;
  const d = strokes - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double';
}

export interface Ratio { hit: number; of: number }
export interface ParRow { par: 3 | 4 | 5; holes: number; /** Average strokes over par on these holes. */ toPar: number }
export interface BestRound { gross: number; /** Null when the round is not one this viewer may open. */ roundId: string | null; date: string }

export interface GolfTotals {
  rounds: number;
  /** Complete, with a gross score. */
  scored: number;
  /** Holes with strokes and a par. */
  holesScored: number;
  /** Average gross of the scored 18-hole rounds. */
  avg18: number | null;
  /** Strokes over par per 18 holes, over every scored round. */
  toPar18: number | null;
  best18: BestRound | null;
  best9: BestRound | null;
  fairways: Ratio;
  greens: Ratio;
  /** Putts per 18 holes, over the holes that recorded putts. */
  putts18: number | null;
  penalties: number;
  kinds: Record<ScoreKind, number>;
  byPar: ParRow[];
}

export const isScored = (r: Pick<GolfRound, 'complete' | 'gross'>) => r.complete && r.gross !== null && r.gross > 0;
export const golfSeasonOf = (date: string) => date.slice(0, 4);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function better(a: BestRound | null, r: GolfRound): BestRound | null {
  if (r.gross === null) return a;
  // The lower score; on a tie the EARLIER round set it.
  if (a && (a.gross < r.gross || (a.gross === r.gross && a.date <= r.date))) return a;
  return { gross: r.gross, roundId: r.hidden ? null : r.id, date: r.date };
}

/**
 * Every number of a set of rounds. `seesHidden` (the athlete, a guardian) keeps
 * a hidden round as a door; for anyone else it still counts and opens nothing.
 */
export function golfTotals(rounds: readonly GolfRound[], seesHidden = false): GolfTotals {
  const kinds: Record<ScoreKind, number> = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  const par = new Map<number, { holes: number; over: number }>();
  const fairways: Ratio = { hit: 0, of: 0 };
  const greens: Ratio = { hit: 0, of: 0 };
  let scored = 0, holesScored = 0, sum18 = 0, n18 = 0, over = 0, overHoles = 0, putts = 0, puttHoles = 0, penalties = 0;
  let best18: BestRound | null = null;
  let best9: BestRound | null = null;
  for (const r of rounds) {
    const door = seesHidden ? { ...r, hidden: false } : r;
    if (isScored(r)) {
      scored += 1;
      if (r.holes === 18) { sum18 += r.gross!; n18 += 1; best18 = better(best18, door); }
      else if (r.holes === 9) best9 = better(best9, door);
      if (r.par !== null && r.par > 0 && r.holes > 0) { over += r.gross! - r.par; overHoles += r.holes; }
    }
    for (const h of r.holeRows) {
      penalties += h.penalties;
      if (h.putts !== null && h.putts >= 0 && h.strokes !== null) { putts += h.putts; puttHoles += 1; }
      if (h.green !== null) { greens.of += 1; if (h.green) greens.hit += 1; }
      if (h.fairway !== null && h.par !== null && h.par >= 4) { fairways.of += 1; if (h.fairway) fairways.hit += 1; }
      const kind = scoreKindOf(h.par, h.strokes);
      if (!kind) continue;
      holesScored += 1;
      kinds[kind] += 1;
      if (h.par === 3 || h.par === 4 || h.par === 5) {
        const row = par.get(h.par) ?? { holes: 0, over: 0 };
        row.holes += 1;
        row.over += h.strokes! - h.par;
        par.set(h.par, row);
      }
    }
  }
  return {
    rounds: rounds.length,
    scored,
    holesScored,
    avg18: n18 > 0 ? round1(sum18 / n18) : null,
    toPar18: overHoles > 0 ? round1((over / overHoles) * 18) : null,
    best18,
    best9,
    fairways,
    greens,
    putts18: puttHoles > 0 ? round1((putts / puttHoles) * 18) : null,
    penalties,
    kinds,
    byPar: ([3, 4, 5] as const).filter(p => par.has(p)).map(p => ({ par: p, holes: par.get(p)!.holes, toPar: round2(par.get(p)!.over / par.get(p)!.holes) })),
  };
}

export interface CourseRow { course: string; rounds: number; scored: number; toPar18: number | null; best18: number | null; best9: number | null }

/** The rounds by course — most played first, then by name. The name is matched without case or outer spaces. */
export function golfByCourse(rounds: readonly GolfRound[]): CourseRow[] {
  const by = new Map<string, { label: string; list: GolfRound[] }>();
  for (const r of rounds) {
    const key = r.course.trim().toLowerCase();
    const row = by.get(key) ?? { label: r.course.trim(), list: [] };
    row.list.push(r);
    by.set(key, row);
  }
  return [...by.values()]
    .map(({ label, list }) => {
      const t = golfTotals(list);
      return { course: label, rounds: t.rounds, scored: t.scored, toPar18: t.toPar18, best18: t.best18?.gross ?? null, best9: t.best9?.gross ?? null };
    })
    .sort((a, b) => b.rounds - a.rounds || a.course.localeCompare(b.course));
}

export interface GolfSeason extends GolfTotals { year: string; courses: CourseRow[] }

/** One row per calendar year that holds a round, newest first. */
export function golfSeasons(rounds: readonly GolfRound[], seesHidden = false): GolfSeason[] {
  const by = new Map<string, GolfRound[]>();
  for (const r of rounds) {
    const year = golfSeasonOf(r.date);
    const list = by.get(year);
    if (list) list.push(r);
    else by.set(year, [r]);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([year, list]) => ({ year, ...golfTotals(list, seesHidden), courses: golfByCourse(list) }));
}

/** A round as the LIST sends it: no holes (they are read a season at a time). */
export type GolfRoundListed = Omit<GolfRound, 'holeRows'> & { toPar: number | null };

/** What a viewer may list: everything for the athlete or a guardian; otherwise never a hidden round. Newest first. */
export function golfListed(rounds: readonly GolfRound[], seesHidden: boolean): GolfRoundListed[] {
  return rounds
    .filter(r => seesHidden || !r.hidden)
    .map(r => ({ id: r.id, date: r.date, course: r.course, location: r.location, tee: r.tee, holes: r.holes, type: r.type, par: r.par, gross: r.gross, complete: r.complete, hidden: r.hidden, toPar: isScored(r) && r.par !== null && r.par > 0 ? r.gross! - r.par : null }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}

export interface KindHole { roundId: string; date: string; course: string; n: number; par: number; strokes: number }

/** The holes behind a score-kind count — what the count opens. Newest round first, then by hole. */
export function holesOfKind(rounds: ReadonlyArray<Pick<GolfRound, 'id' | 'date' | 'course'> & { holeRows: readonly GolfHoleRow[] }>, kind: ScoreKind): KindHole[] {
  const out: KindHole[] = [];
  for (const r of rounds) {
    for (const h of r.holeRows) {
      if (scoreKindOf(h.par, h.strokes) === kind) out.push({ roundId: r.id, date: r.date, course: r.course, n: h.n, par: h.par!, strokes: h.strokes! });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.roundId === b.roundId ? a.n - b.n : a.roundId < b.roundId ? 1 : -1));
}

export interface NineTotals { holes: number; strokes: number; par: number; putts: number | null }

/** A round's front and back nine (holes 1–9, 10–18), over the holes with strokes and a par. */
export function frontBack(holeRows: readonly GolfHoleRow[]): { front: NineTotals | null; back: NineTotals | null } {
  const fold = (list: readonly GolfHoleRow[]): NineTotals | null => {
    const played = list.filter(h => h.strokes !== null && h.par !== null);
    if (played.length === 0) return null;
    const withPutts = played.filter(h => h.putts !== null);
    return { holes: played.length, strokes: played.reduce((n, h) => n + h.strokes!, 0), par: played.reduce((n, h) => n + h.par!, 0), putts: withPutts.length === played.length ? withPutts.reduce((n, h) => n + h.putts!, 0) : null };
  };
  return { front: fold(holeRows.filter(h => h.n <= 9)), back: fold(holeRows.filter(h => h.n >= 10)) };
}

/** "E", "+3", "−2" — a score against par. */
export function toParText(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n === 0) return 'E';
  const abs = Math.abs(n);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${n > 0 ? '+' : '−'}${body}`;
}

/** "62%" of a ratio, or "—" with no attempts. */
export function pctText(r: Ratio): string {
  return r.of > 0 ? `${Math.round((r.hit / r.of) * 100)}%` : '—';
}

/** `?holes=` (the season whose holes are asked) arrives from the URL: a calendar year or nothing. */
export function parseGolfYear(value: string | null | undefined): string | null {
  return value && /^(19|20)\d{2}$/.test(value) ? value : null;
}

// ── A hole's photos and clips ────────────────────────────────────────────────

/** One photo or clip of a round — on a hole (`n`), or of the round as a whole (`n: null`). */
export interface GolfMedia {
  id: string;
  roundId: string;
  n: number | null;
  type: 'image' | 'video';
  url: string;
  poster: string | null;
  seconds: number | null;
}

/**
 * Who may be shown a shared round's media: the group rule of the media proxy
 * (src/lib/media/authorize.ts authorizeGroup, the SQL can_view_group_post) —
 * a public round, its creator, or any participant. The proxy asks again for
 * the bytes; this keeps even the LIST from someone the round is closed to.
 */
export function mayViewRoundMedia(round: { visibility: string | null; creatorId: string | null }, viewerId: string | null, viewerIsParticipant: boolean): boolean {
  if (round.visibility === 'public') return true;
  if (!viewerId) return false;
  return viewerId === round.creatorId || viewerIsParticipant;
}

/** A hole's media, in the order it was added. */
export function mediaOfHole(media: readonly GolfMedia[], roundId: string, n: number): GolfMedia[] {
  return media.filter(m => m.roundId === roundId && m.n === n);
}

/** How many photos and clips each hole of a round has. */
export function mediaCountByHole(media: readonly GolfMedia[], roundId: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of media) if (m.roundId === roundId && m.n !== null) out.set(m.n, (out.get(m.n) ?? 0) + 1);
  return out;
}
