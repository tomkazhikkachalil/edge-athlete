// ── Training's History: every workout and every activity, one list (pure) ────
// Training redesign PR 4 (Nov 11 2026). The workout diary was a window over
// the page that read the last 50 sessions; the activities were a separate
// section with their own "Load more"; the same session could sit in three
// places. History is ONE list, newest first, paged by a keyset cursor over
// both tables, grouped by month. Zero-import: the rules a test can pin.

export type HistoryKind = 'all' | 'workouts' | 'activities';

export const HISTORY_KINDS: ReadonlyArray<{ id: HistoryKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'activities', label: 'Activities' },
];

/** `?kind=` arrives from the URL: anything unrecognised is everything. */
export function parseHistoryKind(value: string | null | undefined): HistoryKind {
  return value === 'workouts' || value === 'activities' ? value : 'all';
}

export const HISTORY_PAGE = 20;

/** What orders a row: when it started, then its id (the cursor's two halves). */
export interface HistoryKey {
  startedAt: string;
  id: string;
}

/**
 * An ISO instant in MICROSECONDS. The database orders by microsecond and
 * `Date.parse` stops at the millisecond: two sessions inside one millisecond
 * would sort one way here and the other way in the cursor's filter, and a row
 * could be skipped between pages.
 */
export function microsOf(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 0;
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? '';
  const micros = Number((fraction + '000000').slice(0, 6));
  return ms * 1000 + (micros % 1000);
}

/** Newest first; the same instant falls back to the id, descending — the order the cursor's filter walks. */
export function compareHistory(a: HistoryKey, b: HistoryKey): number {
  const d = microsOf(b.startedAt) - microsOf(a.startedAt);
  if (d !== 0) return d;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * One page out of several sources. Each source was read newest first with
 * `page + 1` rows past the same cursor, so the first `page` rows of the merge
 * are exactly the next `page` rows of the whole list; one row more than a page
 * anywhere means there is another page.
 */
export function mergeHistoryPage<T extends HistoryKey>(sources: ReadonlyArray<readonly T[]>, page: number = HISTORY_PAGE): { items: T[]; more: boolean } {
  const all = sources.flat().sort(compareHistory);
  return { items: all.slice(0, page), more: all.length > page };
}

export interface HistoryMonth<T> {
  /** "2026-11" — stable across locales, the React key. */
  key: string;
  /** "November 2026" */
  label: string;
  items: T[];
}

/** Rows already newest first, cut into months of the VIEWER's own calendar (a session at 11 pm on the 31st is that month's). */
export function groupByMonth<T extends { startedAt: string }>(items: readonly T[], locale: string = 'en-US'): HistoryMonth<T>[] {
  const out: HistoryMonth<T>[] = [];
  for (const item of items) {
    const d = new Date(item.startedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, label: d.toLocaleDateString(locale, { month: 'long', year: 'numeric' }), items: [item] });
  }
  return out;
}
