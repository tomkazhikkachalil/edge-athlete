/**
 * Pure helpers for the athlete-profile filter system (vitals, equipment,
 * achievements). All year math works on the string parts of ISO dates —
 * never `new Date('YYYY-MM-DD').getFullYear()`, which parses as UTC midnight
 * and shifts a day (and potentially a year) in western timezones.
 */

/** Sentinel option value representing a NULL sport_key (general achievement). */
export const GENERAL_SPORT_KEY = 'general';

/** Calendar year of an ISO date or timestamp string ('2024-03-05', '2024-03-05T12:00:00Z'). */
export function yearOf(dateStr: string): number {
  return parseInt(dateStr.slice(0, 4), 10);
}

/** Unique years present in a list of date strings, newest first. Nulls skipped. */
export function deriveYearOptions(dates: Array<string | null | undefined>): number[] {
  const years = new Set<number>();
  for (const d of dates) {
    if (!d) continue;
    const y = yearOf(d);
    if (Number.isFinite(y)) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * "In bag during year" — true when the item was owned at any point during
 * `year`: acquired in or before it, and not retired before it. A null
 * acquired date is treated as owned-since-forever; a null retired date as
 * still in the bag.
 */
export function isInBagDuringYear(
  acquiredOn: string | null | undefined,
  retiredOn: string | null | undefined,
  year: number
): boolean {
  if (acquiredOn && yearOf(acquiredOn) > year) return false;
  if (retiredOn && yearOf(retiredOn) < year) return false;
  return true;
}

/**
 * Year options for the equipment filter: every year each item spent in the
 * bag (acquisition through retirement, or through the current year while
 * active) — so mid-span years like 2022 for gear owned 2021–2023 are offered.
 */
export function deriveInBagYearOptions(
  items: Array<{ acquiredOn: string | null | undefined; retiredOn: string | null | undefined }>,
  currentYear: number = new Date().getFullYear()
): number[] {
  const years = new Set<number>();
  for (const item of items) {
    if (!item.acquiredOn) continue;
    const start = yearOf(item.acquiredOn);
    const end = item.retiredOn ? yearOf(item.retiredOn) : currentYear;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let y = start; y <= Math.max(start, end); y++) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/** Empty filter = everything matches. */
export function matchesYearFilter(dateStr: string, years: number[]): boolean {
  if (years.length === 0) return true;
  return years.includes(yearOf(dateStr));
}

/**
 * Empty filter = everything matches. A NULL sport matches when the filter
 * includes the GENERAL_SPORT_KEY sentinel.
 */
export function matchesSportFilter(
  sportKey: string | null | undefined,
  sports: string[]
): boolean {
  if (sports.length === 0) return true;
  return sports.includes(sportKey ?? GENERAL_SPORT_KEY);
}

/**
 * Display formatter for DATE strings, timezone-safe: '2024-03-05' → 'Mar 2024'
 * (or '2024' with { yearOnly: true }). Built from string parts so the date
 * never shifts across the user's timezone.
 */
export function formatMonthYear(dateStr: string, opts?: { yearOnly?: boolean }): string {
  const year = dateStr.slice(0, 4);
  if (opts?.yearOnly) return year;
  const monthIndex = parseInt(dateStr.slice(5, 7), 10) - 1;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = MONTHS[monthIndex];
  return month ? `${month} ${year}` : year;
}
