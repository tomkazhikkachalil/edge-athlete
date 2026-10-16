// ── The picker's "Recent" row (activities details A3, Oct 16 2026) — pure ───
// 26 types at 375 px is a scroll; the industry's answer is the last-used
// types first. Kept on the device (a convenience, not a fact): the reader
// and writer wrap storage in try/catch and an empty list just shows no row.

import { isActivityType, type ActivityType } from '../catalog';

export const RECENT_TYPES_MAX = 6;
export const RECENT_TYPES_KEY = 'ea:record:recent-types:v1';

/** `type` moved to the front, no duplicates, at most `max`. */
export function pushRecent(list: readonly ActivityType[], type: ActivityType, max = RECENT_TYPES_MAX): ActivityType[] {
  return [type, ...list.filter(t => t !== type)].slice(0, max);
}

/** A stored value → the known types it names, in order, deduplicated. */
export function parseRecent(raw: unknown, max = RECENT_TYPES_MAX): ActivityType[] {
  if (!Array.isArray(raw)) return [];
  const out: ActivityType[] = [];
  for (const v of raw) if (isActivityType(v) && !out.includes(v)) out.push(v);
  return out.slice(0, max);
}

export function readRecentTypes(): ActivityType[] {
  try {
    return parseRecent(JSON.parse(localStorage.getItem(RECENT_TYPES_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function rememberRecentType(type: ActivityType): void {
  try {
    localStorage.setItem(RECENT_TYPES_KEY, JSON.stringify(pushRecent(readRecentTypes(), type)));
  } catch {
    // blocked storage: no Recent row next time
  }
}
