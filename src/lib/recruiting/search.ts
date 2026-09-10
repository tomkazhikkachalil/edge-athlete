// ── Scout search — the pure half (Recruiting skeleton R4) ─────────────────
// The query contract for GET /api/scout/search: a name/handle needle, a
// sport, a grad-year window. Zero heavy imports (the page reads it).

export interface RecruitingSearchParams {
  q: string;
  sport: string | null;
  gradFrom: number | null;
  gradTo: number | null;
}

export const SCOUT_SEARCH_LIMIT = 50;
const GRAD_YEAR_MIN = 2000;
const GRAD_YEAR_MAX = 2100;

function year(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= GRAD_YEAR_MIN && n <= GRAD_YEAR_MAX ? n : null;
}

/** Tolerant: junk reads as "no filter"; a reversed window is swapped. */
export function parseRecruitingSearchParams(get: (key: string) => string | null): RecruitingSearchParams {
  const q = (get('q') ?? '').trim().slice(0, 80);
  const sport = (get('sport') ?? '').trim().slice(0, 40) || null;
  let gradFrom = year(get('gradFrom'));
  let gradTo = year(get('gradTo'));
  if (gradFrom !== null && gradTo !== null && gradFrom > gradTo) [gradFrom, gradTo] = [gradTo, gradFrom];
  return { q, sport, gradFrom, gradTo };
}

/** PostgREST `ilike` pattern for a contains-match: the wildcard characters
 *  and the filter separators in user text are escaped, never interpolated raw. */
export function containsPattern(needle: string): string {
  const escaped = needle.replace(/[\\%_]/g, c => `\\${c}`).replace(/[,.()]/g, ' ').trim();
  return `%${escaped}%`;
}
