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
