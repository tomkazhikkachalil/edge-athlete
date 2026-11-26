// ── Favourite sports: the picker's rules (Oct 27 2026, migration 285) ────────
// Pure, zero imports. The favourites are a set of registry sport keys stored
// as a JSON array on the owner's profile row (profiles.favourite_sports).
// Every read goes through `sanitizeFavouriteSports` — the column is `unknown`
// to the app, so junk never breaks a render — and every change answers the
// WHOLE list IN THE ORDER ADDED (Tom, Nov 25 2026: the newest favourite goes
// at the end, so the section does not jump around), which the one writer
// (favourites-server.ts) stores. Lists stored before that day are in
// alphabetical order and keep it.
// The registry stays the only source of sports: callers pass the keys in.

/** The body cap (zod): far above the registry, so a legitimate list never
 *  meets it; the sanitizer's real cap is the registry itself. */
export const MAX_FAVOURITE_SPORTS = 32;

/** Any value → the known keys it names, deduped, in the order given (the
 *  first mention of a key keeps its place). */
export function sanitizeFavouriteSports(raw: unknown, known: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !known.includes(item)) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** A switch tap: remove in place if present, add AT THE END if not; an
 *  unknown key is a no-op. */
export function toggleFavourite(current: readonly string[], key: string, known: readonly string[]): string[] {
  const clean = sanitizeFavouriteSports(current, known);
  if (!known.includes(key)) return clean;
  return clean.includes(key)
    ? clean.filter(k => k !== key)
    : [...clean, key];
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
 * The two sections of the picker, filtered by the same query. ONE HOME PER
 * SPORT (Tom, Nov 25 2026): a sport is in exactly one of them.
 *   favourites — the ENABLED favourites, in the stored order (newest last);
 *   all        — every other sport, alphabetical, so a sport that stops
 *                being a favourite returns to its alphabetical place.
 * A favourite of a sport that is off stays stored and stays in `all`, where
 * its locked row still says "Soon" — it never vanishes.
 */
export function partitionSports<T extends PickerSport>(
  sports: readonly T[],
  favourites: readonly string[],
  query: string,
): { favourites: T[]; all: T[] } {
  const matching = sports.filter(s => matchesSportQuery(s, query));
  const pinned: T[] = [];
  for (const key of favourites) {
    const hit = matching.find(s => s.sport_key === key);
    if (hit && hit.enabled && !pinned.includes(hit)) pinned.push(hit);
  }
  return {
    favourites: pinned,
    all: matching.filter(s => !pinned.includes(s)).sort(byName),
  };
}

/**
 * The line that stands where the Favourites section would be: only for an
 * account that can favourite, has no favourite to show, and is not searching
 * (a search with no favourite match just hides the section).
 */
export function showFavouritesHint(favouritesShown: number, query: string, canFavourite: boolean): boolean {
  return canFavourite && favouritesShown === 0 && query.trim() === '';
}

/**
 * The picker's LAST tag (Nov 23 2026): the sport of the account's newest
 * sport post. Any value in → that key only when the registry knows it AND it
 * is still on; 'general', junk and a sport switched off since all answer
 * null (no tag), never a tag on a tile that cannot be picked.
 */
export function lastUsedSport(raw: unknown, sports: readonly PickerSport[]): string | null {
  if (typeof raw !== 'string') return null;
  const hit = sports.find(s => s.sport_key === raw);
  return hit && hit.enabled ? hit.sport_key : null;
}

export interface TileBox { left: number; top: number }

/**
 * The slide (FLIP): how far a tile must be drawn BACK from where it now sits
 * to where it sat before the list changed. Null when it was not on screen
 * before, or has not moved a whole pixel — nothing to animate.
 */
export function moveOffset(before: TileBox | undefined, after: TileBox): { dx: number; dy: number } | null {
  if (!before) return null;
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return { dx, dy };
}

/** How long a tile takes to slide to its new place (Tom: "about 200ms"). */
export const TILE_MOVE_MS = 200;
