/**
 * Pure grouping/counting helpers for the Equipment tab's "mini sport
 * profile" layout: per sport, a Current Setup section (active gear) and a
 * year-grouped History section (retired gear). Kept out of the component so
 * the node-only vitest setup can pin the date edge cases.
 */

import { yearOf, isInBagDuringYear } from '@/lib/profile-filters';

export interface EquipmentDatesLike {
  status: 'active' | 'retired';
  acquired_on?: string | null;
  added_at?: string | null;
  retired_on?: string | null;
  retired_at?: string | null;
}

export const EARLIER_BUCKET = 'earlier' as const;

export interface RetiredYearBucket<T> {
  /** A calendar year, or 'earlier' for retired items with no usable date. */
  year: number | typeof EARLIER_BUCKET;
  items: T[];
}

/**
 * Group retired items by retirement year, newest year first, with an
 * 'earlier' bucket at the end for rows with no retirement date (legacy data
 * predating the date columns). Uses the user-entered date first, the server
 * audit timestamp as fallback — same precedence the ownership line renders.
 */
export function groupRetiredByYear<T extends EquipmentDatesLike>(
  items: T[]
): RetiredYearBucket<T>[] {
  const byYear = new Map<number, T[]>();
  const undated: T[] = [];

  for (const item of items) {
    if (item.status !== 'retired') continue;
    const retired = item.retired_on ?? item.retired_at;
    if (!retired) {
      undated.push(item);
      continue;
    }
    const year = yearOf(retired);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(item);
  }

  const buckets: RetiredYearBucket<T>[] = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, bucketItems]) => ({ year, items: bucketItems }));
  if (undated.length) buckets.push({ year: EARLIER_BUCKET, items: undated });
  return buckets;
}

/** "5 active · 3 retired" numbers for a sport section header. */
export function countByStatus(items: Array<{ status: 'active' | 'retired' }>): {
  active: number;
  retired: number;
} {
  let active = 0;
  let retired = 0;
  for (const item of items) {
    if (item.status === 'active') active++;
    else retired++;
  }
  return { active, retired };
}

export interface EquipmentSearchable extends EquipmentDatesLike {
  brand: string;
  model: string;
  category: string;
  notes?: string | null;
}

/**
 * Case-insensitive substring search over brand, model, category (raw value
 * AND the humanized label the athlete actually sees) and notes. Empty query
 * passes everything through.
 */
export function filterEquipmentBySearch<T extends EquipmentSearchable>(
  items: T[],
  query: string,
  categoryLabel: (item: T) => string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(item =>
    [item.brand, item.model, item.category, categoryLabel(item), item.notes ?? '']
      .some(field => field.toLowerCase().includes(q))
  );
}

export type EquipmentSort = 'newest' | 'brand' | 'category';

/**
 * Sort for display within a group. 'newest' orders by acquisition (user date
 * first, audit timestamp fallback, undated last); 'brand' A–Z then model;
 * 'category' by the caller-supplied category rank (equipment-config order)
 * then brand. Returns a new array.
 */
export function sortEquipment<T extends EquipmentSearchable>(
  items: T[],
  sort: EquipmentSort,
  categoryRank: (item: T) => number
): T[] {
  const acquired = (item: T): number => {
    const date = item.acquired_on ?? item.added_at;
    return date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY;
  };
  const byBrand = (a: T, b: T) =>
    a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model);

  const sorted = [...items];
  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => acquired(b) - acquired(a) || byBrand(a, b));
      break;
    case 'brand':
      sorted.sort(byBrand);
      break;
    case 'category':
      sorted.sort((a, b) => categoryRank(a) - categoryRank(b) || byBrand(a, b));
      break;
  }
  return sorted;
}

// ── Rail navigation model ─────────────────────────────────────────────────────

export interface EquipmentNavCategory {
  value: string;
  label: string;
  /** Active-item count (the rail navigates the current setup). */
  count: number;
  anchorId: string;
}

export interface EquipmentNavSport {
  sportKey: string;
  label: string;
  anchorId: string;
  categories: EquipmentNavCategory[];
  retiredCount: number;
  historyAnchorId: string;
}

/**
 * Stable DOM anchor for a sport (or sport+category) section. Shared by the
 * rail and the section renderer so the two can never drift.
 */
export function equipmentAnchorId(sport: string, category?: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return category ? `equip-${slug(sport)}-${slug(category)}` : `equip-${slug(sport)}`;
}

/**
 * The rail's data model: sports (caller-ordered via sortedSportKeys) with
 * their active categories (config order via categoryRank, unknown free-text
 * categories after, alphabetical) and retired counts. Config lookups are
 * injected so this stays pure and node-testable.
 */
export function buildEquipmentNav<T extends EquipmentSearchable & { sport_key?: string | null }>(
  items: T[],
  opts: {
    sortedSportKeys: string[];
    sportLabel: (sportKey: string) => string;
    categoryLabel: (sportKey: string, category: string) => string;
    categoryRank: (sportKey: string, category: string) => number;
  }
): EquipmentNavSport[] {
  return opts.sortedSportKeys.map(sportKey => {
    const sportItems = items.filter(i => (i.sport_key || 'general') === sportKey);
    const active = sportItems.filter(i => i.status === 'active');
    const byCategory = new Map<string, number>();
    for (const item of active) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    }
    const categories: EquipmentNavCategory[] = [...byCategory.entries()]
      .sort((a, b) => {
        const rankDiff = opts.categoryRank(sportKey, a[0]) - opts.categoryRank(sportKey, b[0]);
        return rankDiff !== 0
          ? rankDiff
          : opts.categoryLabel(sportKey, a[0]).localeCompare(opts.categoryLabel(sportKey, b[0]));
      })
      .map(([value, count]) => ({
        value,
        count,
        label: opts.categoryLabel(sportKey, value),
        anchorId: equipmentAnchorId(sportKey, value),
      }));
    return {
      sportKey,
      label: opts.sportLabel(sportKey),
      anchorId: equipmentAnchorId(sportKey),
      categories,
      retiredCount: sportItems.length - active.length,
      historyAnchorId: `${equipmentAnchorId(sportKey)}-history`,
    };
  });
}

// ── Seasons view ─────────────────────────────────────────────────────────────

/** 'now' = the current setup + History; a year = that season's in-bag gear. */
export type EquipmentView = 'now' | number;

/**
 * Season filter. 'now' is the identity — the layout itself splits
 * active/retired there. A year keeps every item that was IN THE BAG during
 * that year (active during it, INCLUDING gear retired since), which is what
 * "what did they play with in 2024" means. Undated retired items can never
 * match a year — they remain reachable only via History's "Earlier" bucket
 * in the 'now' view, which is why History is not replaced by this switcher.
 */
export function filterEquipmentForView<T extends EquipmentDatesLike>(
  items: T[],
  view: EquipmentView
): T[] {
  if (view === 'now') return items;
  return items.filter(item => {
    // isInBagDuringYear reads a null retirement date as "still in the bag" —
    // right for ACTIVE gear, but an undated RETIRED item would ghost into
    // every season. Those stay History-only.
    if (item.status === 'retired' && !(item.retired_on ?? item.retired_at)) return false;
    return isInBagDuringYear(
      item.acquired_on ?? item.added_at,
      item.retired_on ?? item.retired_at ?? null,
      view
    );
  });
}
