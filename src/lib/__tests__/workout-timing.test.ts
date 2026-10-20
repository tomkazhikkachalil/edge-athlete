import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AT_SLACK_MS, clampAt, finishDuration, isTimed, planPause, planResume, workoutElapsedS } from '../workouts/timing';
import { abandonFinalizeFields } from '../workouts/status';
import { sessionSeconds } from '../workouts/dashboard';
import { buildDraftsList } from '../drafts/list';

// Workout screen PR 2 (Oct 12 2026, 260): the clock's rules — pauses excluded,
// standing while paused, a finish never before an open pause, an untimed
// workout with no duration. Server facts stamped with the CLIENT's clock.

const T0 = Date.UTC(2026, 9, 12, 8, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('workoutElapsedS', () => {
  it('runs from the start, excludes closed pauses, stands while paused, stops at the end', () => {
    expect(workoutElapsedS({ started_at: iso(T0) }, T0 + 90_000)).toBe(90);
    expect(workoutElapsedS({ started_at: iso(T0), paused_seconds: 30 }, T0 + 90_000)).toBe(60);
    expect(workoutElapsedS({ started_at: iso(T0), paused_seconds: 30, paused_at: iso(T0 + 70_000) }, T0 + 500_000)).toBe(40);
    expect(workoutElapsedS({ started_at: iso(T0), paused_seconds: 30, ended_at: iso(T0 + 100_000) }, T0 + 999_000)).toBe(70);
    expect(workoutElapsedS({ started_at: 'garbage' }, T0)).toBe(0);
    expect(workoutElapsedS({ started_at: iso(T0) }, T0 - 5000)).toBe(0);
  });
});

describe('clampAt — the client stamp is believed within reason', () => {
  it('keeps a stamp inside [started, now + slack]; garbage is now', () => {
    expect(clampAt(iso(T0 + 10_000), T0, T0 + 60_000)).toBe(T0 + 10_000);
    expect(clampAt(iso(T0 - 10_000), T0, T0 + 60_000)).toBe(T0);
    expect(clampAt(iso(T0 + 999_999_999), T0, T0 + 60_000)).toBe(T0 + 60_000 + AT_SLACK_MS);
    expect(clampAt('nope', T0, T0 + 60_000)).toBe(T0 + 60_000);
    expect(clampAt(undefined, T0, T0 + 60_000)).toBe(T0 + 60_000);
  });
});

describe('finishDuration — the one finish rule', () => {
  it('excludes closed pauses and the open one; an untimed workout has no duration', () => {
    expect(finishDuration({ started_at: iso(T0), paused_seconds: 60 }, T0 + 600_000)).toEqual({ endedMs: T0 + 600_000, durationSeconds: 540 });
    expect(finishDuration({ started_at: iso(T0), paused_seconds: 60, paused_at: iso(T0 + 300_000) }, T0 + 600_000)).toEqual({ endedMs: T0 + 600_000, durationSeconds: 240 });
    expect(finishDuration({ started_at: iso(T0), timed: false }, T0 + 600_000).durationSeconds).toBeNull();
  });
  it('a requested end BEFORE an open pause (the reopen prompt sends the last activity) is moved to the pause — never a negative, never inflated', () => {
    const plan = finishDuration({ started_at: iso(T0), paused_seconds: 0, paused_at: iso(T0 + 300_000) }, T0 + 120_000);
    expect(plan.endedMs).toBe(T0 + 300_000);
    expect(plan.durationSeconds).toBe(300);
  });
  it('a requested end before the start is the start', () => {
    expect(finishDuration({ started_at: iso(T0) }, T0 - 1000)).toEqual({ endedMs: T0, durationSeconds: 0 });
  });
});

describe('planPause / planResume — compare-and-set plans, the client clock', () => {
  const live = { status: 'active', started_at: iso(T0), timed: true, paused_at: null, paused_seconds: 0 };
  it('pause: active, timed, not paused; the stamp is clamped and also moves last_activity_at', () => {
    const p = planPause(live, iso(T0 + 100_000), T0 + 120_000);
    expect(p).toEqual({ ok: true, update: { paused_at: iso(T0 + 100_000), last_activity_at: iso(T0 + 100_000) } });
    expect(planPause({ ...live, status: 'completed' }, null, T0)).toMatchObject({ ok: false, status: 409 });
    expect(planPause({ ...live, timed: false }, null, T0)).toMatchObject({ ok: false, status: 400 });
    expect(planPause({ ...live, paused_at: iso(T0 + 10_000) }, null, T0 + 20_000)).toMatchObject({ ok: false, status: 409 });
  });
  it('resume: closes the pause into paused_seconds, never before the pause, and names the paused_at it read as the CAS', () => {
    const paused = { ...live, paused_at: iso(T0 + 100_000), paused_seconds: 15 };
    const r = planResume(paused, iso(T0 + 160_000), T0 + 170_000);
    expect(r).toEqual({ ok: true, update: { paused_seconds: 75, paused_at: null, last_activity_at: iso(T0 + 160_000) }, expectPausedAt: iso(T0 + 100_000) });
    // A stamp before the pause (clock skew) counts as resuming at the pause.
    expect(planResume(paused, iso(T0 + 50_000), T0 + 170_000)).toMatchObject({ ok: true, update: { paused_seconds: 15 } });
    expect(planResume(live, null, T0)).toMatchObject({ ok: false, status: 409 });
  });
  it('the route applies the plans with their compare-and-sets, and the finish nulls the pause', () => {
    const route = read('src/app/api/workouts/[id]/route.ts');
    expect(route).toMatch(/\.eq\('status', 'active'\)\.is\('paused_at', null\)\.select\('\*'\)/);
    expect(route).toMatch(/\.eq\('paused_at', plan\.expectPausedAt\)\.select\('\*'\)/);
    expect(route).toMatch(/updates\.paused_at = null;/);
    expect(route).toMatch(/select\('profile_id, status, started_at, timed, paused_seconds, paused_at, share_decided_at'\)/);
  });
});

describe('the readers follow the clock', () => {
  it('the sweep finishes an abandoned session through the same rule (pauses excluded, the pause closed, NULL when untimed)', () => {
    const f = abandonFinalizeFields({ startedAt: iso(T0), lastActivityAt: iso(T0 + 3600_000), pausedSeconds: 600, pausedAt: null });
    expect(f).toEqual({ status: 'completed', ended_at: iso(T0 + 3600_000), duration_seconds: 3000, paused_at: null });
    expect(abandonFinalizeFields({ startedAt: iso(T0), lastActivityAt: iso(T0 + 3600_000), timed: false }).duration_seconds).toBeNull();
    // Paused, then abandoned: it ends at the pause, which is after the last set.
    expect(abandonFinalizeFields({ startedAt: iso(T0), lastActivityAt: iso(T0 + 1000_000), pausedAt: iso(T0 + 2000_000) })).toMatchObject({ ended_at: iso(T0 + 2000_000), duration_seconds: 2000 });
    expect(read('src/lib/workouts/sweep-server.ts')).toMatch(/select\('id, status, started_at, last_activity_at, paused_seconds, paused_at, timed'\)/);
  });
  it('isTimed defaults true (rows before 260); sessionSeconds counts an UNTIMED workout as 0 — before the wall-clock fallback', () => {
    expect(isTimed({})).toBe(true);
    expect(isTimed({ timed: null })).toBe(true);
    expect(isTimed({ timed: false })).toBe(false);
    const base = { id: 's', profile_id: 'p', title: null, notes: null, status: 'completed' as const, source: 'live' as const, started_at: iso(T0), ended_at: iso(T0 + 3600_000), duration_seconds: null, post_id: null, last_activity_at: iso(T0), updated_at: iso(T0) };
    expect(sessionSeconds({ ...base, timed: false })).toBe(0);
    expect(sessionSeconds(base)).toBe(3600);
  });
  it("the pill's clock: runs from the start plus the pauses, stands while paused, absent when untimed", () => {
    const w = (over: Record<string, unknown>) => buildDraftsList({ rounds: [], workouts: [{ id: 'w', status: 'active', title: null, started_at: iso(T0), last_activity_at: iso(T0 + 60_000), ...over }] }).inProgress[0];
    expect(w({ paused_seconds: 30 }).clockStartAt).toBe(iso(T0 + 30_000));
    expect(w({ paused_at: iso(T0 + 50_000) }).clockPausedAt).toBe(iso(T0 + 50_000));
    expect(w({ timed: false }).clockStartAt).toBeNull();
    expect(w({})).toMatchObject({ clockStartAt: iso(T0), clockPausedAt: null });
    expect(read('src/lib/drafts/server.ts')).toMatch(/share_decided_at, timed, paused_seconds, paused_at/);
  });
  it('the editor: the label is gone, the clock takes the pause, the menu offers Hide timer and Don\'t time', () => {
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).not.toMatch(/>Saved</);
    expect(editor).not.toMatch(/Saving…</);
    expect(editor).toMatch(/data-workout-save-error=""/);
    expect(editor).toMatch(/data-workout-pause=/);
    expect(editor).toMatch(/testId: 'workout-menu-hide-timer'/);
    expect(editor).toMatch(/testId: 'workout-menu-timed'/);
    expect(editor).toMatch(/\?\? \(timed \? elapsedNow\(\) : null\)/);
    const clock = read('src/components/workouts/LiveClock.tsx');
    expect(clock).toMatch(/workoutElapsedS\(\{ started_at: startedAt, paused_seconds: pausedSeconds, paused_at: pausedAt \}, now\)/);
  });
});
