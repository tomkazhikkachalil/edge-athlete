/**
 * Equipment display preferences — the contract behind the Equipment tab's
 * settings gear (profiles.equipment_prefs JSONB, migration 065).
 *
 * Pure and defensive: `sanitizeEquipmentPrefs` accepts ANY value (the column
 * is athlete-written JSONB) and returns only known keys with valid values —
 * it never throws, because one malformed pref must never break a profile
 * render. NULL/absent prefs mean the defaults, i.e. pre-065 behavior.
 */

export type EquipmentCardDetail = 'detailed' | 'compact';

export interface EquipmentPrefs {
  /** Sport display order; [0] is also the rail's default-expanded group. */
  sportOrder?: string[];
  defaultSort?: 'newest' | 'brand';
  /** 'now' or a season year the tab opens on. */
  defaultView?: 'now' | number;
  /** Visitors don't see History sections (owner always does). */
  hideHistory?: boolean;
  /** Visitors don't see these sports at all (server-enforced in the GET). */
  hiddenSports?: string[];
  /** compact hides spec lines + notes on cards, for everyone. */
  cardDetail?: EquipmentCardDetail;
}

const MAX_SPORTS = 20;
const MAX_KEY_LENGTH = 40;

function sanitizeSportList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0 && v.length <= MAX_KEY_LENGTH)
    .slice(0, MAX_SPORTS);
  // De-dup preserving order
  return [...new Set(list)];
}

export function sanitizeEquipmentPrefs(raw: unknown): EquipmentPrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const prefs: EquipmentPrefs = {};

  const sportOrder = sanitizeSportList(source.sportOrder);
  if (sportOrder && sportOrder.length > 0) prefs.sportOrder = sportOrder;

  if (source.defaultSort === 'newest' || source.defaultSort === 'brand') {
    prefs.defaultSort = source.defaultSort;
  }

  if (source.defaultView === 'now') {
    prefs.defaultView = 'now';
  } else if (
    typeof source.defaultView === 'number' &&
    Number.isInteger(source.defaultView) &&
    source.defaultView >= 1900 &&
    source.defaultView <= 2200
  ) {
    prefs.defaultView = source.defaultView;
  }

  if (typeof source.hideHistory === 'boolean') prefs.hideHistory = source.hideHistory;

  const hiddenSports = sanitizeSportList(source.hiddenSports);
  if (hiddenSports && hiddenSports.length > 0) prefs.hiddenSports = hiddenSports;

  if (source.cardDetail === 'detailed' || source.cardDetail === 'compact') {
    prefs.cardDetail = source.cardDetail;
  }

  return prefs;
}

/**
 * Order the sports actually present by the athlete's preference: preferred
 * order first (only sports that exist), everything unlisted appended in the
 * caller's fallback order (typically alphabetical).
 */
export function orderSportKeys(present: string[], prefs: EquipmentPrefs): string[] {
  const order = prefs.sportOrder ?? [];
  const preferred = order.filter(sport => present.includes(sport));
  const rest = present.filter(sport => !preferred.includes(sport));
  return [...preferred, ...rest];
}
