// ── Favourite sports: the picker's rules (Oct 27 2026, migration 285) ────────
// Pure, zero imports. The favourites are a set of registry sport keys stored
// as a JSON array on the owner's profile row (profiles.favourite_sports).
// Every read goes through `sanitizeFavouriteSports` — the column is `unknown`
// to the app, so junk never breaks a render — and every change answers the
// WHOLE sorted list, which the one writer (favourites-server.ts) stores.
// The registry stays the only source of sports: callers pass the keys in.

/** The body cap (zod): far above the registry, so a legitimate list never
 *  meets it; the sanitizer's real cap is the registry itself. */
export const MAX_FAVOURITE_SPORTS = 32;

/** Any value → the known keys it names, deduped and SORTED (canonical bytes:
 *  two devices that favourite the same set store the same array). */
export function sanitizeFavouriteSports(raw: unknown, known: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !known.includes(item)) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out.sort();
}

/** A star tap: remove if present, add if not; an unknown key is a no-op. */
export function toggleFavourite(current: readonly string[], key: string, known: readonly string[]): string[] {
  const clean = sanitizeFavouriteSports(current, known);
  if (!known.includes(key)) return clean;
  return clean.includes(key)
    ? clean.filter(k => k !== key)
    : sanitizeFavouriteSports([...clean, key], known);
}

export interface PickerSport {
  sport_key: string;
  display_name: string;
  enabled: boolean;
}

/** The search: trimmed, case-folded, a substring of the name or the key
 *  (so "mma" and "bjj" still hit). Empty matches everything. */
export function matchesSportQuery(sport: PickerSport, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return sport.display_name.toLowerCase().includes(q) || sport.sport_key.toLowerCase().includes(q);
}

function byName<T extends PickerSport>(a: T, b: T): number {
  return a.display_name.localeCompare(b.display_name, 'en', { sensitivity: 'base' });
}

/**
 * The two sections of the picker, both alphabetical and both filtered by the
 * same query. `favourites` holds only ENABLED favourites (a favourite of a
 * sport that is off later stays stored and hidden); `all` holds every sport,
 * on or off, so a locked row still says "Coming soon".
 */
export function partitionSports<T extends PickerSport>(
  sports: readonly T[],
  favourites: readonly string[],
  query: string,
): { favourites: T[]; all: T[] } {
  const matching = sports.filter(s => matchesSportQuery(s, query)).sort(byName);
  return {
    favourites: matching.filter(s => s.enabled && favourites.includes(s.sport_key)),
    all: matching,
  };
}
