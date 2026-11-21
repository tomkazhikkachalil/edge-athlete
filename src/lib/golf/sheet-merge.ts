// ── One scorecard from several answers (Nov 16 2026) — pure, zero imports ───
// Tom: whole scorecards disappeared and tee sets went missing. The weekly
// refresh replaced a stored card WHOLESALE with whatever the row's own provider
// answered: a card found by name on one provider was overwritten by a thinner
// answer from the other. The rule here: a stored card never gets poorer. A new
// answer only FILLS (a tee's yardages, a stroke index, a rating, a slope) and
// an answer that looks like a different course is refused, never blended in.

export interface SheetHole {
  number: number;
  par: number;
  yardage: Record<string, number>;
  handicap: number;
}

export interface Sheet {
  total_par: number | null;
  holes_count: number | null;
  hole_data: SheetHole[] | null;
  course_rating: Record<string, number> | null;
  slope_rating: Record<string, number> | null;
}

/** At most this many pars may differ between two answers for one course: a
 *  card can correct a slip, a same-named different course disagrees on many
 *  holes (the same number the map card is protected by). */
export const SHEET_PAR_DIFF_MAX = 2;

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const holesOf = (s: Pick<Sheet, 'hole_data'> | null | undefined): SheetHole[] => (Array.isArray(s?.hole_data) ? s.hole_data : []);

/** Are two sets of holes the same course? One's hole numbers contain the
 *  other's (a nine inside an eighteen fits) and the shared holes differ on at
 *  most two pars. Either side empty: nothing to disagree with. */
export function sheetsAgree(
  a: ReadonlyArray<Pick<SheetHole, 'number' | 'par'>>,
  b: ReadonlyArray<Pick<SheetHole, 'number' | 'par'>>
): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const pars = new Map(large.map(h => [h.number, h.par]));
  let differ = 0;
  for (const h of small) {
    if (!pars.has(h.number)) return false;
    if (pars.get(h.number) !== h.par) differ++;
  }
  return differ <= SHEET_PAR_DIFF_MAX;
}

function fillKeys(stored: Record<string, number> | null | undefined, incoming: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(incoming ?? {})) if (k && positive(v)) out[k] = v;
  // The stored value wins — and a stored key is kept whatever it holds.
  for (const [k, v] of Object.entries(stored ?? {})) if (!(k in out) || positive(v)) out[k] = v;
  return out;
}

export interface SheetMerge {
  sheet: Sheet;
  /** The incoming answer added something the stored card lacked. */
  changed: boolean;
  /** The incoming holes look like a different course: nothing was taken. */
  refused: boolean;
}

/** The stored card with the incoming answer's values filled into its gaps.
 *  No hole, tee or value the stored card holds is ever removed or replaced. */
export function mergeSheets(stored: Sheet, incoming: Sheet): SheetMerge {
  const mine = holesOf(stored);
  const theirs = holesOf(incoming);
  if (!sheetsAgree(mine, theirs)) return { sheet: stored, changed: false, refused: true };

  const byNumber = new Map(mine.map(h => [h.number, h]));
  const incomingByNumber = new Map(theirs.map(h => [h.number, h]));
  const numbers = [...new Set([...byNumber.keys(), ...incomingByNumber.keys()])].sort((x, y) => x - y);
  const holes: SheetHole[] = numbers.map(n => {
    const s = byNumber.get(n);
    const i = incomingByNumber.get(n);
    if (!s) return { number: n, par: i!.par, yardage: fillKeys(null, i!.yardage), handicap: i!.handicap || 0 };
    return {
      number: n,
      par: s.par,
      yardage: fillKeys(s.yardage, i?.yardage),
      handicap: s.handicap || i?.handicap || 0,
    };
  });

  const sheet: Sheet = {
    total_par: stored.total_par ?? incoming.total_par ?? null,
    holes_count: holes.length > mine.length ? holes.length : stored.holes_count ?? incoming.holes_count ?? (holes.length || null),
    hole_data: holes.length ? holes : stored.hole_data ?? null,
    course_rating: fillKeys(stored.course_rating, incoming.course_rating),
    slope_rating: fillKeys(stored.slope_rating, incoming.slope_rating),
  };
  // A card that grew from nine to eighteen has a new total; the old one was the nine's.
  if (holes.length > mine.length && mine.length > 0) sheet.total_par = incoming.total_par ?? null;

  const size = (s: Sheet) =>
    holesOf(s).reduce((n, h) => n + 1 + Object.values(h.yardage ?? {}).filter(positive).length + (h.handicap ? 1 : 0), 0) +
    Object.keys(s.course_rating ?? {}).length +
    Object.keys(s.slope_rating ?? {}).length +
    (s.total_par != null ? 1 : 0);
  return { sheet, changed: size(sheet) > size(stored), refused: false };
}

export type SheetGap = 'pars' | 'yardage' | 'strokeIndex' | 'ratings';

/** What a card still lacks. `pars` = no holes at all; `yardage` = a hole with
 *  no real yardage for any tee; `strokeIndex` = a hole without one; `ratings` =
 *  no tee has both a course rating and a slope. */
export function sheetGaps(sheet: Pick<Sheet, 'hole_data' | 'course_rating' | 'slope_rating'>): SheetGap[] {
  const holes = holesOf(sheet);
  if (holes.length === 0) return ['pars', 'yardage', 'strokeIndex', 'ratings'];
  const gaps: SheetGap[] = [];
  if (holes.some(h => !Object.values(h.yardage ?? {}).some(positive))) gaps.push('yardage');
  if (holes.some(h => !positive(h.handicap))) gaps.push('strokeIndex');
  const slope = sheet.slope_rating ?? {};
  if (!Object.entries(sheet.course_rating ?? {}).some(([k, v]) => positive(v) && positive(slope[k]))) gaps.push('ratings');
  return gaps;
}

export function sheetComplete(sheet: Pick<Sheet, 'hole_data' | 'course_rating' | 'slope_rating'>): boolean {
  return sheetGaps(sheet).length === 0;
}

/** Which source supplied what on a card (migration 313): one name for the
 *  pars and for the stroke indexes, one per tee's yardages, one per rated tee.
 *  Lets one vendor's data be found, and removed, if its terms ever require it. */
export interface SheetSources {
  pars?: string;
  strokeIndex?: string;
  tees?: Record<string, string>;
  ratings?: Record<string, string>;
  /** True when two providers agreed with each other against the map card
   *  and their card was taken (Nov 18 2026; course-catalog findOfficialSheet). */
  mapOverruled?: boolean;
  /** Holes on which the provider's own tee boxes gave different pars, when
   *  its card supplied the pars (parsFromTees, Nov 20 2026). */
  parsDisputed?: number[];
}

/** One card's pars out of a provider's tee boxes (Nov 20 2026). Measured on
 *  GolfCourseAPI for Angus Glen (South): the Black tee said hole 1 is a par 5
 *  (total 73) while Gold and Blue said par 4 (total 72, the club's printed
 *  card), and two short men's tees shortened other holes. The card used to be
 *  whatever the first box said.
 *
 *  Each hole takes the par MOST of the voting boxes give it; a tie keeps the
 *  reference box's par when it is among the tied ones, else the earliest
 *  box's. A box with no par for a hole does not vote on it, and a hole no
 *  voter knows takes the first par any box knows (never a guess).
 *
 *  `voters` are the boxes that decide: the caller passes the MEN's boxes when
 *  there are any, because a women's par is often a different, correct par for
 *  the same hole and must not outvote the card. Measured the same day on the
 *  40 cards production held: taking the whole card most boxes share (the first
 *  version of this rule) would have swapped Rivermead's correct card for its
 *  women's one, 11 boxes to 10. Hole by hole among the men's boxes agrees
 *  with the saved card on 34 of the 38 that could be re-read. Of the four it
 *  changes, published cards confirm it on two (Eagles Nest, Falcon Ridge),
 *  contradict it on one (Champlain: only the back tee carries the true par of
 *  hole 5, and three shorter men's tees outvote it) and are unclear on one.
 *  The old first-box rule was wrong on three. So this is the better default,
 *  NOT a proof: the provider's boxes contradict each other and nothing in its
 *  answer says which is the club's card. `disputed` exists so that is visible.
 *
 *  `yards` (Nov 20 2026, later the same day) are the same boxes' hole lengths,
 *  box by box. With them two things change, both measured on the 40 holes of
 *  production whose men's tees disagree:
 *   - a par that is impossible for its length does not vote (believablePar:
 *     Eagles Nest's white box says hole 1 is a par 3 at 501 yards);
 *   - when the TWO LONGEST voting tees agree, that is the par, whatever the
 *     shorter tees say. A hole shortened for the forward tees often drops a
 *     stroke of par there, and the club's printed card follows the back tees
 *     (Angus Glen North's 11th: 5, 5, 4, 4, 4, the card says 5). When they do
 *     not agree the count decides as before (Angus Glen South's 1st: the back
 *     tee alone says 5, the card says 4).
 *  Still the better default, not a proof.
 *
 *  `disputed` are the hole numbers on which the voters did not all agree. Pure. */
export function parsFromTees(
  boxes: ReadonlyArray<ReadonlyArray<number | null | undefined>>,
  reference = 0,
  voters?: ReadonlyArray<number>,
  yards?: ReadonlyArray<ReadonlyArray<number | null | undefined> | null | undefined>
): { pars: Array<number | null>; disputed: number[] } {
  const length = boxes[reference]?.length ?? 0;
  const same = boxes.map((b, i) => ({ b, i })).filter(x => x.b.length === length);
  const chosen = voters ? same.filter(x => voters.includes(x.i)) : same;
  const voting = chosen.length > 0 ? chosen : same;
  const lengthOf = (i: number, h: number): number | null => {
    const y = yards?.[i]?.[h];
    return typeof y === 'number' && y > 0 ? y : null;
  };
  type Box = { b: ReadonlyArray<number | null | undefined>; i: number };
  const rawPar = (x: Box, h: number): number | null => x.b[h] ?? null;
  // A par impossible for its length loses its vote, but only to a believable
  // one: a hole on which NO box is believable keeps what the boxes say (bad
  // lengths must never turn a card into no card).
  const believable = (x: Box, h: number): number | null => {
    const p = rawPar(x, h);
    return p !== null && believablePar(p, lengthOf(x.i, h)) ? p : null;
  };
  const pars: Array<number | null> = [];
  const disputed: number[] = [];
  for (let h = 0; h < length; h++) {
    const parOf = yards && same.some(x => believable(x, h) !== null) ? believable : rawPar;
    const votes = voting.map(x => ({ i: x.i, par: parOf(x, h) })).filter((v): v is { i: number; par: number } => v.par !== null);
    const said = votes.map(v => v.par);
    if (said.length === 0) {
      pars.push(same.map(x => parOf(x, h)).find((p): p is number => p != null) ?? null);
      continue;
    }
    const count = new Map<number, number>();
    for (const p of said) count.set(p, (count.get(p) ?? 0) + 1);
    if (count.size > 1) disputed.push(h + 1);
    // The two longest voting tees, when both lengths are known and they agree.
    const byLength = votes.map(v => ({ ...v, y: lengthOf(v.i, h) })).filter((v): v is { i: number; par: number; y: number } => v.y !== null).sort((a, b) => b.y - a.y);
    if (count.size > 1 && byLength.length >= 2 && byLength[0].par === byLength[1].par) {
      pars.push(byLength[0].par);
      continue;
    }
    const top = Math.max(...count.values());
    const tied = said.filter(p => count.get(p) === top);
    const ref = voting.some(x => x.i === reference) ? parOf({ b: boxes[reference], i: reference }, h) : null;
    pars.push(ref != null && tied.includes(ref) ? ref : tied[0]);
  }
  return { pars, disputed };
}

/** Could a hole of this length be this par at all? Deliberately WIDE: a
 *  forward tee keeps its hole's par at a length no back tee would (production,
 *  Nov 20 2026, 6,012 tee-and-hole pairs: par 4s from 130 yards and par 5s
 *  from 235 are real cards). Only the plainly impossible fails: two boxes in
 *  those 6,012, a par 3 at 501 yards and one at 391. An unknown length passes. */
export function believablePar(par: number, yards: number | null | undefined): boolean {
  if (typeof yards !== 'number' || !(yards > 0)) return true;
  if (par === 3) return yards <= 300;
  if (par === 4) return yards >= 100 && yards <= 560;
  if (par === 5) return yards >= 200 && yards <= 800;
  if (par === 6) return yards >= 500;
  return false;
}

/** Is a provider's card whole and in agreement with itself? Holes numbered
 *  1..n for a nine or an eighteen, every par 3 to 6, the pars adding up to
 *  the card's OWN stated total, and at least one yardage. What ONE provider's
 *  card must be before it may stand against a map card (Nov 18 2026). */
export function sheetSelfConsistent(sheet: Pick<Sheet, 'hole_data' | 'total_par'>): boolean {
  const holes = holesOf(sheet);
  const n = holes.length;
  if (n !== 9 && n !== 18) return false;
  if (![...holes].map(h => h.number).sort((a, b) => a - b).every((v, i) => v === i + 1)) return false;
  if (holes.some(h => !Number.isInteger(h.par) || h.par < 3 || h.par > 6)) return false;
  if (typeof sheet.total_par !== 'number' || holes.reduce((sum, h) => sum + h.par, 0) !== sheet.total_par) return false;
  return holes.some(h => Object.values(h.yardage ?? {}).some(positive));
}

/** Do two providers' cards say the same course strongly enough to outvote a
 *  map card? Stricter than sheetsAgree: the SAME holes (a nine does not
 *  confirm an eighteen) and at most two pars apart. */
export function providersConfirm(
  a: ReadonlyArray<Pick<SheetHole, 'number' | 'par'>>,
  b: ReadonlyArray<Pick<SheetHole, 'number' | 'par'>>
): boolean {
  return a.length > 0 && a.length === b.length && sheetsAgree(a, b);
}

/** The credits after `source`'s answer turned `before` into `after`. Only what
 *  is NEW is credited: a value the card already held keeps its first source. */
export function creditSources(prev: SheetSources | null | undefined, before: Sheet, after: Sheet, source: string): SheetSources {
  const out: SheetSources = { ...(prev ?? {}), tees: { ...(prev?.tees ?? {}) }, ratings: { ...(prev?.ratings ?? {}) } };
  const was = holesOf(before);
  const now = holesOf(after);
  if (now.length > was.length && !out.pars) out.pars = source;
  const indexed = (holes: SheetHole[]) => holes.filter(h => positive(h.handicap)).length;
  if (indexed(now) > indexed(was) && !out.strokeIndex) out.strokeIndex = source;
  const teeKeys = (holes: SheetHole[]) => new Set(holes.flatMap(h => Object.entries(h.yardage ?? {}).filter(([, v]) => positive(v)).map(([k]) => k)));
  const hadTees = teeKeys(was);
  for (const k of teeKeys(now)) if (!hadTees.has(k) && !out.tees![k]) out.tees![k] = source;
  const rated = (s: Sheet) => new Set([...Object.keys(s.course_rating ?? {}), ...Object.keys(s.slope_rating ?? {})]);
  const hadRated = rated(before);
  for (const k of rated(after)) if (!hadRated.has(k) && !out.ratings![k]) out.ratings![k] = source;
  if (Object.keys(out.tees!).length === 0) delete out.tees;
  if (Object.keys(out.ratings!).length === 0) delete out.ratings;
  return out;
}

/** A NINE's card out of an eighteen that combines two nines (Nov 19 2026).
 *  Measured on GolfCourseAPI for Ottawa Hunt's three nines: the listing named
 *  "North" is North + South, "South" is South + West, "West" is West + North.
 *  So each nine is the FRONT of the listing that carries its name and the BACK
 *  of a sibling's. The front nine of `card` is returned as this nine's card
 *  only when a sibling confirms it: the sibling's holes 10–18 have the same
 *  pars, hole for hole, and one tee of each has the same nine yardages. Not
 *  confirmed → null (the eighteen is somebody else's card, as before).
 *  The stroke indexes are dropped (they rank eighteen holes, not nine). Pure. */
export function nineFromCombination(card: ReadonlyArray<SheetHole>, siblings: ReadonlyArray<ReadonlyArray<SheetHole>>): SheetHole[] | null {
  const span = (holes: ReadonlyArray<SheetHole>, from: number): SheetHole[] | null => {
    if (holes.length !== 18) return null;
    const nine = Array.from({ length: 9 }, (_, i) => holes.find(h => h.number === from + i));
    return nine.every((h): h is SheetHole => !!h && h.par >= 3 && h.par <= 6) ? nine : null;
  };
  const tees = (nine: SheetHole[]): string[] =>
    Object.keys(nine[0].yardage ?? {})
      .filter(k => nine.every(h => typeof h.yardage?.[k] === 'number' && h.yardage[k] > 0))
      .map(k => nine.map(h => h.yardage[k]).join(','));
  const front = span(card, 1);
  if (!front) return null;
  const mine = new Set(tees(front));
  if (mine.size === 0) return null;
  const confirmed = siblings.some(s => {
    const back = span(s, 10);
    return !!back && back.every((h, i) => h.par === front[i].par) && tees(back).some(t => mine.has(t));
  });
  if (!confirmed) return null;
  return front.map((h, i) => ({ number: i + 1, par: h.par, yardage: { ...h.yardage }, handicap: 0 }));
}
