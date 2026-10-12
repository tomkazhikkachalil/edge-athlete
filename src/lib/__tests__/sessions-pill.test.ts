import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pickPillSession, pillElapsedS, pillLabel, pillMetric, pillShows, PILL_KIND_ICON } from '../sessions/pill';
import { isSessionScreen } from '../sessions/paths';
import { getProgressVersion, publishProgress, readProgress, resetProgressForTests, subscribeProgress } from '../sessions/progress-store';
import { reopenSkipsPath } from '../drafts/reopen';
import { buildDraftsList, countWorkoutSets, type DraftItem } from '../drafts/list';
import { showsTabBar } from '../tab-bar';

// The resume pill (Oct 12 2026): while a workout, a recording or a round is
// in progress, one pill on every page — what it is, a live clock, one
// metric — and a tap lands back in it.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const item = (over: Partial<DraftItem>): DraftItem => ({
  kind: 'workout', id: 'w1', postId: null, state: 'in_progress', title: 'Legs', startedAt: '2026-10-12T08:00:00Z', clockStartAt: '2026-10-12T08:00:00Z', lastActivityAt: null, href: '/app/workout/w1', isCreator: true, scored: true, progress: null, ...over,
});

describe('where the pill shows', () => {
  it('on the signed-in places the tab bar knows, never on a session\'s own screen, never signed out', () => {
    for (const p of ['/feed', '/calendar', '/athlete', '/athlete/x', '/sports/explore', '/app/notifications', '/live', '/league/l1', '/u/tom']) expect(pillShows({ pathname: p, signedIn: true }), p).toBe(true);
    for (const p of ['/live/gp1', '/activities/record', '/app/workout/w1', '/athlete/drafts', '/athlete/drafts/p1', null, '']) expect(pillShows({ pathname: p, signedIn: true }), String(p)).toBe(false);
    expect(pillShows({ pathname: '/feed', signedIn: false })).toBe(false);
  });
  it('every screen without the tab bar is without the pill (it owns its bottom edge)', () => {
    for (const p of ['/messages/c1', '/sports/events/new', '/events/11111111-1111-4111-8111-111111111111/live', '/', '/privacy', '/onboarding', '/org/slug']) {
      expect(showsTabBar(p)).toBe(false);
      expect(pillShows({ pathname: p, signedIn: true }), p).toBe(false);
    }
  });
  it('the session-screen list is ONE list, shared with the reopen prompt', () => {
    for (const p of ['/live/gp1', '/activities/record', '/app/workout/w1', '/athlete/drafts', '/athlete/drafts/p1', null]) {
      expect(isSessionScreen(p)).toBe(true);
      expect(reopenSkipsPath(p)).toBe(true);
    }
    for (const p of ['/feed', '/live', '/activities/a1', '/app/notifications']) {
      expect(isSessionScreen(p)).toBe(false);
      expect(reopenSkipsPath(p)).toBe(false);
    }
    expect(read('src/lib/drafts/reopen.ts')).toMatch(/isSessionScreen/);
    expect(read('src/lib/drafts/reopen.ts')).not.toMatch(/SKIP_PREFIXES/);
  });
});

describe('what the pill shows', () => {
  it('the most recently touched in-progress thing — the list is newest-first; a draft is never a pill', () => {
    expect(pickPillSession([item({ state: 'draft', id: 'd' }), item({ id: 'live' })])?.id).toBe('live');
    expect(pickPillSession([])).toBeNull();
    expect(pickPillSession([item({ state: 'draft' })])).toBeNull();
  });
  it('the clock is derived from the start timestamp, never counted', () => {
    const start = Date.parse('2026-10-12T08:00:00Z');
    expect(pillElapsedS('2026-10-12T08:00:00Z', start + 12_345_000)).toBe(12_345);
    expect(pillElapsedS('2026-10-12T08:00:00Z', start - 1000)).toBe(0);
    expect(pillElapsedS(null, start)).toBeNull();
    expect(pillElapsedS('garbage', start)).toBeNull();
    // A paused recording's clock stands where it was paused.
    expect(pillElapsedS('2026-10-12T08:00:00Z', start + 999_000, '2026-10-12T08:05:00Z')).toBe(300);
  });
  it('a recording\'s clock runs from its start plus its closed pauses, and stands while paused', () => {
    const started = Date.parse('2026-10-12T09:00:00Z');
    const live = buildDraftsList({ rounds: [], workouts: [], recording: { id: 'r', label: 'Walk', savedAt: started + 60_000, startedAt: started, pausedTotalMs: 30_000, pausedAt: null } }).inProgress[0];
    expect(live.clockStartAt).toBe('2026-10-12T09:00:30.000Z');
    expect(live.clockPausedAt).toBeNull();
    const paused = buildDraftsList({ rounds: [], workouts: [], recording: { id: 'r', label: 'Walk', savedAt: started + 60_000, startedAt: started, pausedTotalMs: 0, pausedAt: started + 45_000 } }).inProgress[0];
    expect(pillElapsedS(paused.clockStartAt, started + 999_000, paused.clockPausedAt)).toBe(45);
  });
  it('one metric per kind: "Thru N/holes", "N sets", the live distance — or nothing honest', () => {
    expect(pillMetric({ kind: 'round' }, { holesCompleted: 7, holesPlayed: 18 })).toBe('Thru 7/18');
    expect(pillMetric({ kind: 'round' }, { holesCompleted: 7 })).toBe('Thru 7');
    expect(pillMetric({ kind: 'round' }, { holesCompleted: 0, holesPlayed: 9 })).toBe('No scores yet');
    expect(pillMetric({ kind: 'round' }, null)).toBeNull();
    expect(pillMetric({ kind: 'workout' }, { setsCompleted: 1 })).toBe('1 set');
    expect(pillMetric({ kind: 'workout' }, { setsCompleted: 5 })).toBe('5 sets');
    expect(pillMetric({ kind: 'workout' }, { setsCompleted: 0 })).toBe('No sets yet');
    expect(pillMetric({ kind: 'recording' }, { distanceM: 2100 }, m => `${(m / 1000).toFixed(1)} km`)).toBe('2.1 km');
    expect(pillMetric({ kind: 'recording' }, { distanceM: 2100 })).toBeNull();
    expect(pillMetric({ kind: 'recording' }, { distanceM: null }, m => String(m))).toBeNull();
  });
  it('the accessible name says what, how long and how far', () => {
    expect(pillLabel({ kind: 'round', title: 'Pine Hills' }, '1:02:03', 'Thru 7/18')).toBe('Resume your round at Pine Hills · 1:02:03 · Thru 7/18');
    expect(pillLabel({ kind: 'workout', title: 'Workout' }, '12:00', null)).toBe('Resume your workout · 12:00');
    expect(pillLabel({ kind: 'workout', title: 'Legs' }, '12:00', '3 sets')).toBe('Resume your workout Legs · 12:00 · 3 sets');
    expect(pillLabel({ kind: 'recording', title: 'Walk (on this phone)' }, '0:30', null)).toBe('Resume your walk · 0:30');
  });
  it('an icon per kind, the Drafts rows\' spelling', () => {
    expect(PILL_KIND_ICON).toEqual({ round: 'fa-golf-ball-tee', workout: 'fa-dumbbell', recording: 'fa-person-walking' });
  });
});

describe('the drafts list carries the pill\'s clock and number', () => {
  it('a round\'s clock is its creation instant (its date is a day); its number the viewer\'s holes scored', () => {
    const list = buildDraftsList({
      rounds: [{ id: 'gp1', status: 'active', date: '2026-10-12', created_at: '2026-10-12T14:03:00Z', holes_completed: 4, holes_played: 9, post_id: 'p1', course_name: 'Pine Hills', title: null, isCreator: true, lastScoreAt: '2026-10-12T15:00:00Z', postIsDraft: true, sportEventRoundId: null }],
      workouts: [],
    });
    expect(list.inProgress[0]).toMatchObject({ startedAt: '2026-10-12', clockStartAt: '2026-10-12T14:03:00Z', progress: { holesCompleted: 4, holesPlayed: 9 } });
  });
  it('a workout\'s clock is started_at; its number counts sets with something in them (summary.ts\'s rule)', () => {
    const list = buildDraftsList({
      rounds: [],
      workouts: [{ id: 'w1', status: 'active', title: null, started_at: '2026-10-12T08:00:00Z', last_activity_at: '2026-10-12T08:30:00Z', sets: [{ reps: 5, weight: 100 }, { reps: null, weight: null, duration_seconds: 30 }, { reps: 0, weight: 0, duration_seconds: null, distance: null }, {}] }],
    });
    expect(list.inProgress[0]).toMatchObject({ clockStartAt: '2026-10-12T08:00:00.000Z', progress: { setsCompleted: 2 } });
    expect(countWorkoutSets(null)).toBe(0);
    expect(countWorkoutSets([{ distance: 2 }])).toBe(1);
  });
  it('a recording\'s clock is its start on this phone; none before Start', () => {
    const started = Date.parse('2026-10-12T09:00:00Z');
    const list = buildDraftsList({ rounds: [], workouts: [], recording: { id: 'r', label: 'Walk', savedAt: started + 60_000, startedAt: started } });
    expect(list.inProgress[0].clockStartAt).toBe('2026-10-12T09:00:00.000Z');
    expect(buildDraftsList({ rounds: [], workouts: [], recording: { id: 'r', label: 'Walk', savedAt: started, startedAt: null } }).inProgress[0].clockStartAt).toBeNull();
  });
  it('the server reader selects the clock and the number (the viewer\'s own score row; the sessions\' sets)', () => {
    const server = read('src/lib/drafts/server.ts');
    expect(server).toMatch(/scores:golf_participant_scores \( holes_completed \)/);
    expect(server).toMatch(/created_at/);
    expect(server).toMatch(/golf_data:golf_scorecard_data \( course_name, holes_played \)/);
    expect(server).toMatch(/exercises:workout_exercises \( sets:workout_sets \( reps, weight, duration_seconds, distance \) \)/);
  });
});

describe('the progress store', () => {
  beforeEach(() => resetProgressForTests());
  it('the session screen publishes; the pill reads by kind + id; the same number publishes nothing', () => {
    let calls = 0;
    const off = subscribeProgress(() => { calls += 1; });
    const v0 = getProgressVersion();
    publishProgress('workout', 'w1', { setsCompleted: 3 });
    publishProgress('workout', 'w1', { setsCompleted: 3 });
    expect(calls).toBe(1);
    expect(getProgressVersion()).toBe(v0 + 1);
    expect(readProgress('workout', 'w1')).toEqual({ setsCompleted: 3 });
    expect(readProgress('round', 'w1')).toBeNull();
    publishProgress('round', 'gp1', { holesCompleted: 2, holesPlayed: 9 });
    expect(calls).toBe(2);
    off();
    publishProgress('round', 'gp1', { holesCompleted: 3, holesPlayed: 9 });
    expect(calls).toBe(2);
  });
  it('the workout editor and the live page publish; every door that starts or ends a session refreshes the list', () => {
    expect(read('src/components/workouts/WorkoutEditorScreen.tsx')).toMatch(/publishProgress\('workout', session\.id, \{ setsCompleted: summary\.totalSets \}\)/);
    expect(read('src/app/(app)/live/[groupPostId]/page.tsx')).toMatch(/publishProgress\('round', groupPostId/);
    for (const f of ['src/components/VitalsTab.tsx', 'src/components/CreatePostModal.tsx', 'src/hooks/useEndRound.ts', 'src/hooks/useDeleteRound.ts', 'src/components/workouts/WorkoutEditorScreen.tsx']) {
      expect(read(f), f).toMatch(/refreshDrafts\(\)/);
    }
  });
});

describe('the pill component', () => {
  it('is mounted once in the app root layout, beside the reopen prompt, inside the recording provider', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout.match(/<ResumePill \/>/g)?.length).toBe(1);
    expect(layout).toMatch(/<ReopenPromptHost \/>/);
    expect(layout.match(/<RecordingProvider>/g)?.length).toBe(1);
    expect(layout.indexOf('<RecordingProvider>')).toBeLessThan(layout.indexOf('<ResumePill />'));
  });
  it('the root chunk never imports the recording engine: the provider loads it with next/dynamic', () => {
    const provider = read('src/components/activities/record/RecordingProvider.tsx');
    expect(provider).toMatch(/dynamic\(\(\) => import\('\.\/RecordingEngineHost'\), \{ ssr: false \}\)/);
    expect(provider).not.toMatch(/from '@\/lib\/activities\/record\/recording'/);
    expect(provider).not.toMatch(/from '@\/lib\/activities\/gps-filter'/);
    const store = read('src/lib/activities/record/engine-store.ts');
    expect(store.match(/^import (?!type )/gm) ?? []).toEqual([]);
    expect(store).toMatch(/^import type /m);
    const pill = read('src/components/sessions/ResumePill.tsx');
    expect(pill).not.toMatch(/from '@\/lib\/activities\/record\/recording'/);
  });
  it('sits above the tab bar (its measured height already carries the safe-area inset) and under the header on a large screen; z-[35]', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/\.ea-resume-pill \{\s*bottom: calc\(var\(--ea-tabbar-h, env\(safe-area-inset-bottom, 0px\)\) \+ 12px\);/);
    expect(css).toMatch(/\.ea-resume-pill \{\s*bottom: auto;\s*top: calc\(var\(--ea-banner-h, 0px\) \+ 4rem \+ 0\.75rem\);/);
    const pill = read('src/components/sessions/ResumePill.tsx');
    expect(pill).toMatch(/z-\[35\]/);
    expect(pill).not.toMatch(/z-\[70\]/);
    expect(pill).toMatch(/data-resume-pill=\{`\$\{item\.kind\}:\$\{item\.id\}`\}/);
  });
  it('the editor flushes a pending edit when it unmounts (an in-app route change)', () => {
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).toMatch(/return \(\) => \{\s*if \(debounceRef\.current\) \{\s*clearTimeout\(debounceRef\.current\);\s*debounceRef\.current = null;\s*flushRef\.current\(\);/);
  });
});
