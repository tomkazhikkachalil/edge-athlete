// ── The resume pill's rules (resume pill program, Oct 12 2026) — pure ───────
// Tom: "while a workout or activity is in progress, show a small pill on
// every page … the activity type, the elapsed time counting live, and one
// key metric … tapping it opens the active session." The component
// (components/sessions/ResumePill.tsx) renders what these decide; nothing
// here touches the DOM. Two imports, both pure: the tab bar's allowlist
// (where the app's signed-in places are, minus every screen that owns its
// bottom edge) and the session-screen list the reopen prompt shares.

import type { DraftItem } from '@/lib/drafts/list';
import { showsTabBar } from '@/lib/tab-bar';
import { isSessionScreen } from './paths';
import type { SessionProgress } from './progress-store';

/** The ONE thing the pill shows: the most recently touched in-progress item (the list is already newest-first). */
export function pickPillSession(inProgress: ReadonlyArray<DraftItem>): DraftItem | null {
  return inProgress.find(i => i.state === 'in_progress') ?? null;
}

/**
 * Where the pill shows: the signed-in places the tab bar knows (the same
 * allowlist at every width — a thread's composer, the event wizard and the
 * live stat strip own their bottom edge and go without), never on a
 * session's own screen, never signed out or while auth boots.
 */
export function pillShows(input: { pathname: string | null | undefined; signedIn: boolean }): boolean {
  if (!input.signedIn) return false;
  if (isSessionScreen(input.pathname)) return false;
  return showsTabBar(input.pathname);
}

/** Seconds on the clock since `clockStartAt` — derived from the timestamp, never counted (a closed app or a locked phone changes nothing). */
export function pillElapsedS(clockStartAt: string | null, now: number): number | null {
  if (!clockStartAt) return null;
  const t = Date.parse(clockStartAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

/** The one metric beside the clock, or null when there is nothing honest to say. */
export function pillMetric(item: Pick<DraftItem, 'kind'>, progress: SessionProgress | null, formatDistance?: (m: number) => string): string | null {
  if (item.kind === 'round') {
    const thru = progress?.holesCompleted;
    if (typeof thru !== 'number') return null;
    if (thru <= 0) return 'No scores yet';
    return typeof progress?.holesPlayed === 'number' && progress.holesPlayed > 0 ? `Thru ${thru}/${progress.holesPlayed}` : `Thru ${thru}`;
  }
  if (item.kind === 'workout') {
    const sets = progress?.setsCompleted;
    if (typeof sets !== 'number') return null;
    if (sets <= 0) return 'No sets yet';
    return `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  }
  const m = progress?.distanceM;
  if (typeof m !== 'number' || !Number.isFinite(m) || !formatDistance) return null;
  return formatDistance(m);
}

export const PILL_KIND_ICON: Readonly<Record<DraftItem['kind'], string>> = {
  round: 'fa-golf-ball-tee',
  workout: 'fa-dumbbell',
  recording: 'fa-person-walking',
};

/** The accessible name: what it is, how long, how far. */
export function pillLabel(item: Pick<DraftItem, 'kind' | 'title'>, elapsed: string | null, metric: string | null): string {
  const what = item.kind === 'round' ? `your round at ${item.title}` : item.kind === 'workout' ? `your workout${item.title && item.title !== 'Workout' ? ` ${item.title}` : ''}` : `your ${item.title.replace(/ \(on this phone\)$/, '').toLowerCase()}`;
  return ['Resume ' + what, elapsed, metric].filter(Boolean).join(' · ');
}
