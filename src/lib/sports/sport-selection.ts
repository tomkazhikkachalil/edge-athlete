// ── Sport multi-select rules ──────────────────────────────────────────────────
// Pure logic behind SportMultiSelect (onboarding + edit profile). Order is
// meaningful: the FIRST selection is the athlete's primary sport.

import type { SportKey } from './SportRegistry';

export const MAX_SELECTED_SPORTS = 3;

/**
 * Toggle a sport in the selection. Adding beyond the cap is a no-op;
 * removing the first entry promotes the next selection to primary.
 */
export function toggleSportSelection(
  current: SportKey[],
  key: SportKey,
  max: number = MAX_SELECTED_SPORTS
): SportKey[] {
  if (current.includes(key)) {
    return current.filter(k => k !== key);
  }
  if (current.length >= max) return current;
  return [...current, key];
}
