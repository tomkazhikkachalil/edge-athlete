/** Shared validation for user-supplied 'YYYY-MM-DD' DATE strings. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Well-formed AND a real calendar date (rejects 2024-02-31). */
export function isValidDateString(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Not future-dated. Compared against tomorrow UTC so a user just past
 * midnight in a timezone ahead of the server isn't rejected for entering
 * their local "today".
 */
export function isNotFutureDate(dateStr: string): boolean {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return dateStr <= tomorrow;
}
