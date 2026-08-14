/**
 * People search — the PURE half: query normalisation and the ranking ladder.
 *
 * Deliberately free of server imports so client components can rank a cached
 * result set locally (the typeahead's progressive-narrowing path) without
 * pulling `auth-server` into a browser bundle. The server call lives next
 * door in `people-server.ts`.
 *
 * The ladder here mirrors `search_people()` in migration 087 exactly. Two
 * implementations of one rule is a smell, but the alternative is worse: the
 * SQL cannot be unit-tested (tests are node-only, there is no database in the
 * suite), and the client needs to re-rank cached rows it never sent to the
 * server. Keeping them in lockstep is what the shared table in 087's header
 * and this file's test suite are for.
 */

/** One person as every search surface consumes them. */
export interface PersonSuggestion {
  id: string;
  handle: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  location: string | null;
  sport: string | null;
  school: string | null;
  visibility: string | null;
}

/**
 * Below this, matching is PREFIX-ONLY — both because a trigram index cannot
 * serve a shorter LIKE pattern (see 087's header) and because substring
 * matching on one letter is noise, not a suggestion.
 *
 * Must stay equal to the `is_short := length(q) < 3` gate in `search_people`,
 * or the client would rank a cached row the server would never have returned.
 */
export const WIDE_MATCH_MIN_CHARS = 3;

/**
 * Trim, drop a leading '@' (people type handles both ways), collapse internal
 * whitespace, lowercase. Mirrors the normalisation at the top of
 * `search_people()`.
 */
export function normalizeQuery(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Split a name into words for word-boundary prefix matching. */
function words(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const NAME_FIELDS = ['first_name', 'last_name', 'full_name'] as const;

/**
 * Lower is better; `null` means the person does not match at all.
 *
 *   0  exact handle
 *   1  handle prefix
 *   2  name prefix (first / last / full)
 *   3  word-boundary prefix inside a name  ("kaz" -> "Tom Kazhikkachalil")
 *   4  substring anywhere
 *
 * Tiers 3 and 4 are gated at `WIDE_MATCH_MIN_CHARS` to match the SQL, which
 * gates them because a trigram index cannot serve a shorter pattern. Below
 * that, only the three prefix tiers apply.
 */
export function matchRank(person: PersonSuggestion, normalizedQuery: string): number | null {
  const q = normalizedQuery;
  if (!q) return null;

  const handle = person.handle?.toLowerCase() ?? '';
  if (handle && handle === q) return 0;
  if (handle && handle.startsWith(q)) return 1;

  const names = NAME_FIELDS.map(f => person[f]?.toLowerCase() ?? '').filter(Boolean);
  if (names.some(n => n.startsWith(q))) return 2;

  if (q.length < WIDE_MATCH_MIN_CHARS) return null;

  if (names.some(n => words(n).some(w => w.startsWith(q)))) return 3;
  if (handle.includes(q)) return 4;
  if (names.some(n => n.includes(q))) return 4;

  return null;
}

/** The display string ranking falls back to, matching the SQL's COALESCE. */
function sortKey(person: PersonSuggestion): string {
  return (person.full_name ?? person.handle ?? '').toLowerCase();
}

/**
 * Rank and filter a candidate set. Non-matching people are dropped.
 *
 * Ties break by name length (shorter first — 006's convention for handles),
 * then alphabetically, then by id, so the order is total and stable no matter
 * what order the rows arrived in.
 */
export function rankPeople(
  people: readonly PersonSuggestion[],
  query: string
): PersonSuggestion[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const scored: Array<{ person: PersonSuggestion; rank: number }> = [];
  for (const person of people) {
    const rank = matchRank(person, q);
    if (rank !== null) scored.push({ person, rank });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const ak = sortKey(a.person);
    const bk = sortKey(b.person);
    if (ak.length !== bk.length) return ak.length - bk.length;
    if (ak !== bk) return ak < bk ? -1 : 1;
    return a.person.id < b.person.id ? -1 : a.person.id > b.person.id ? 1 : 0;
  });

  return scored.map(s => s.person);
}
