import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareHistory, groupByMonth, HISTORY_KINDS, HISTORY_PAGE, mergeHistoryPage, microsOf, parseHistoryKind } from '../training/history';
import { mergeTrainingSessions, type ActivitySession, type TrainingSession } from '../training/sessions';

// Training's History (Training redesign PR 4, Nov 11 2026): one list over two tables.
const row = (startedAt: string, id: string, kind: 'workout' | 'activity' = 'workout') => ({ startedAt, id, kind });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('history: the filter', () => {
  it('is All, Workouts, Activities; anything else from the URL is All', () => {
    expect(HISTORY_KINDS.map(k => k.label)).toEqual(['All', 'Workouts', 'Activities']);
    expect(parseHistoryKind('workouts')).toBe('workouts');
    expect(parseHistoryKind('activities')).toBe('activities');
    for (const v of [null, undefined, '', 'all', 'posts', '__proto__']) expect(parseHistoryKind(v)).toBe('all');
  });
});

describe('history: the order the cursor walks', () => {
  it('reads an instant to the microsecond, whatever its offset spelling', () => {
    expect(microsOf('2026-11-11T18:00:00.123456+00:00') - microsOf('2026-11-11T18:00:00.123+00:00')).toBe(456);
    expect(microsOf('2026-11-11T18:00:00+00:00')).toBe(microsOf('2026-11-11T18:00:00Z'));
    expect(microsOf('2026-11-11T13:00:00-05:00')).toBe(microsOf('2026-11-11T18:00:00Z'));
    expect(microsOf('not a date')).toBe(0);
  });

  it('newest first; inside one millisecond the microsecond decides; the same instant falls to the id, descending', () => {
    const a = row('2026-11-11T18:00:00.123400+00:00', uuid(1));
    const b = row('2026-11-11T18:00:00.123900+00:00', uuid(2));
    const c = row('2026-11-11T18:00:00.123900+00:00', uuid(3));
    const d = row('2026-11-12T08:00:00+00:00', uuid(0));
    expect([a, b, c, d].sort(compareHistory).map(r => r.id)).toEqual([uuid(0), uuid(3), uuid(2), uuid(1)]);
  });
});

describe('history: one page out of two sources', () => {
  // 30 workouts on even minutes, 30 activities on odd ones: 60 sessions, strictly interleaved.
  const stamp = (minute: number) => new Date(Date.UTC(2026, 10, 11, 12, 0, 0) - minute * 60_000).toISOString();
  const workouts = Array.from({ length: 30 }, (_, i) => row(stamp(i * 2), uuid(i * 2), 'workout'));
  const activities = Array.from({ length: 30 }, (_, i) => row(stamp(i * 2 + 1), uuid(i * 2 + 1), 'activity'));
  const all = [...workouts, ...activities].sort(compareHistory);
  /** What the server does: each source newest first, a page + 1 rows past the cursor. */
  const read = (source: typeof workouts, cursor: { startedAt: string; id: string } | null) =>
    source.filter(r => !cursor || compareHistory(cursor, r) < 0).slice(0, HISTORY_PAGE + 1);

  it('walking the cursor returns every session exactly once, in order', () => {
    const seen: string[] = [];
    let cursor: { startedAt: string; id: string } | null = null;
    let pages = 0;
    for (;;) {
      const { items, more }: { items: Array<{ startedAt: string; id: string }>; more: boolean } = mergeHistoryPage([read(workouts, cursor), read(activities, cursor)]);
      seen.push(...items.map(i => i.id));
      pages += 1;
      if (!more) break;
      expect(items).toHaveLength(HISTORY_PAGE);
      cursor = items[items.length - 1];
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(all.map(r => r.id));
    expect(new Set(seen).size).toBe(60);
  });

  it('a page is the newest twenty of the WHOLE list, even when one source holds them all', () => {
    const recent = Array.from({ length: 25 }, (_, i) => row(stamp(-100 + i), uuid(1000 + i), 'activity'));
    const { items, more } = mergeHistoryPage([read(workouts, null), read(recent, null)]);
    expect(items.every(i => i.kind === 'activity')).toBe(true);
    expect(more).toBe(true);
    expect(mergeHistoryPage([[], []])).toEqual({ items: [], more: false });
    expect(mergeHistoryPage([workouts.slice(0, 20), []]).more).toBe(false);
  });
});

describe('history: months', () => {
  it('cuts a newest-first list into months, keeping the order; one key per month', () => {
    const items = [row('2026-11-10T12:00:00', 'a'), row('2026-11-02T12:00:00', 'b'), row('2026-10-20T12:00:00', 'c'), row('2025-11-05T12:00:00', 'd')];
    const months = groupByMonth(items);
    expect(months.map(m => [m.key, m.label, m.items.map(i => i.id)])).toEqual([
      ['2026-11', 'November 2026', ['a', 'b']],
      ['2026-10', 'October 2026', ['c']],
      ['2025-11', 'November 2025', ['d']],
    ]);
    expect(groupByMonth([])).toEqual([]);
  });
});

describe('the week counts a year of workouts, not the last fifty', () => {
  it('merges the server-folded workout sessions with the activities, newest first', () => {
    const w: TrainingSession[] = [{ id: 'w1', kind: 'workout', startedAt: '2026-11-10T10:00:00Z', seconds: 3600, volumeLbs: 1540, title: 'Push' }];
    const a: ActivitySession[] = [{ id: 'a1', type: 'run', name: 'Hill repeats', startedAt: '2026-11-11T07:00:00Z', elapsedS: 1900, movingS: 1800, distanceM: 5000 }];
    expect(mergeTrainingSessions(w, a).map(s => [s.id, s.kind, s.seconds])).toEqual([['a1', 'activity', 1800], ['w1', 'workout', 3600]]);
  });
});

describe('the route and the reader hold the privacy rules', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  it('the pure rules import nothing', () => {
    expect(src('lib/training/history.ts')).not.toMatch(/^import /m);
  });
  it('the route takes the activity readers\' ONE gate, then the Training privacy aspect; every answer is private, no-store', () => {
    const route = src('app/api/profile/[profileId]/training/history/route.ts');
    expect(route).toContain('resolveActivityAccess(admin, user?.id ?? null, profileId)');
    expect(route).toContain("aspectHidden(await fetchTrainingPrivacy(admin, profileId), 'workouts', isOwner)");
    expect(route.indexOf('resolveActivityAccess(')).toBeLessThan(route.indexOf('listTrainingHistory('));
    expect(route.indexOf('aspectHidden(')).toBeLessThan(route.indexOf('listTrainingHistory('));
    const answers = route.match(/NextResponse\.json\(/g)?.length ?? 0;
    expect(answers).toBeGreaterThan(5);
    expect(route.match(/headers: NO_STORE/g)?.length).toBe(answers);
    expect(route).toContain("decodeCursor(rawCursor)");
  });
  it('a non-owner never receives a hidden or undecided workout, nor an "Only me" activity; only completed workouts are history', () => {
    const reader = src('lib/training/history-server.ts');
    expect(reader).toContain(".eq('status', 'completed')");
    expect(reader).toContain("if (!isOwner) q = q.is('profile_hidden_at', null).not('share_decided_at', 'is', null);");
    expect(reader).toContain("if (audience !== 'owner') q = q.eq('only_me', false);");
    expect(reader).toContain('projectActivity(row, audience)');
    const year = src('lib/workouts/read-server.ts');
    expect(year).toContain("if (!isOwner) q = q.is('profile_hidden_at', null).not('share_decided_at', 'is', null);");
    expect(year).not.toMatch(/SESSIONS_SELECT =[\s\S]{0,400}media/);
  });
  it('Training reads the year from the History route; the workouts list is no longer what the week counts from', () => {
    const tab = src('components/TrainingTab.tsx');
    expect(tab).toContain('/training/history?sessions=1');
    expect(tab).toContain('mergeTrainingSessions(yearWorkouts, activitySessions)');
    expect(tab).not.toContain('/activities?sessions=1');
    // The posted training items keep their place in Training (Convention 50): the Media tab never holds them.
    expect(tab).toContain('data-training-activity-grid');
  });
});
