/**
 * Pure grouping/counting helpers for the Equipment tab's "mini sport
 * profile" layout: per sport, a Current Setup section (active gear) and a
 * year-grouped History section (retired gear). Kept out of the component so
 * the node-only vitest setup can pin the date edge cases.
 */

import { yearOf } from '@/lib/profile-filters';

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
