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
