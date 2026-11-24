// ── Recent courses (the mechanical dialect, Nov 23 2026) ─────────────────────
// Pure, zero imports. The course step's RECENT list: the catalog courses of
// the account's own latest rounds, each once, newest first. Derived from the
// rounds the account already has — nothing new is stored.
//
// A round lives in one of two places: a round started from the composer
// (live, or already played with the scorecard) is a group post with its
// golf_scorecard_data row; a finished individual round is a golf_rounds row.
// Both are read, and this merges them by when they were made.

export const RECENT_COURSES_MAX = 5;
/** How many of the newest rounds are read from EACH place. */
export const RECENT_ROUNDS_SCANNED = 40;

export interface RecentRoundRow {
  course_id?: unknown;
  /** ISO timestamp the round was made. */
  at?: unknown;
}

/** Rows in any order → the distinct course ids, newest round first, capped.
 *  A round on a typed course has no id and is skipped; a row without a
 *  usable time sorts last (it is still a course the account played). */
export function recentCourseIds(rows: readonly RecentRoundRow[], max: number = RECENT_COURSES_MAX): string[] {
  const time = (row: RecentRoundRow) => {
    const t = typeof row?.at === 'string' ? Date.parse(row.at) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const sorted = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => time(b.row) - time(a.row) || a.i - b.i);
  const out: string[] = [];
  for (const { row } of sorted) {
    const id = row?.course_id;
    if (typeof id !== 'string' || id === '' || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
