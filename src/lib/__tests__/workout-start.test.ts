import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TIMED_DEFAULT_KEY } from '../workouts/timer-prefs';

// Program E2 (Oct 2026): the Workout's set-up step is a ROUTE, nothing is
// written before its Start, and every door lands on it. Read from the source.
const ROOT = process.cwd();
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the Workout starts from /app/workout/start', () => {
  it('the start sheet is gone; every door opens the route; the one POST carries title and timed', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/components/workouts/StartWorkoutSheet.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/app/(app)/app/workout/start/page.tsx'))).toBe(true);
    const hook = code('src/hooks/useStartWorkout.ts');
    expect(hook).toMatch(/const open = \(\) => router\.push\('\/app\/workout\/start'\);/);
    expect(hook).not.toMatch(/showStartSheet|StartWorkoutSheet/);
    expect(hook).toMatch(/\.\.\.\(typeof opts\.timed === 'boolean' \? \{ timed: opts\.timed \} : \{\}\)/);
    expect(hook).toMatch(/refreshDrafts\(\)/);
    for (const f of ['src/components/AppHeader.tsx', 'src/components/TrainingTab.tsx', 'src/components/activities/record/RecordActivityScreen.tsx']) {
      expect(code(f), f).not.toMatch(/StartWorkoutSheet/);
    }
  });
  it('the screen writes nothing before Start: no fetch of its own but the hook\'s; the CTA is fixed; the clock choice is remembered', () => {
    const screen = code('src/components/workouts/WorkoutStartScreen.tsx');
    expect(screen).not.toMatch(/fetch\(/);
    expect(screen).toMatch(/data-workout-start=""/);
    expect(screen).toMatch(/writeTimedDefault\(timed\);\s*void start\(routineId, \{ title, timed \}\);/);
    expect(screen).toMatch(/data-workout-start-in-progress=\{inProgress\.id\}/);
    expect(screen).toMatch(/data-workout-start-timed=\{timed \? 'on' : 'off'\}/);
    expect(TIMED_DEFAULT_KEY).toBe('ea:workout:timed-default:v1');
  });
  it('the live branch validates `timed` before any state check and writes it on the insert', () => {
    const route = code('src/app/api/workouts/route.ts');
    expect(route).toMatch(/if \(body\.timed !== undefined && typeof body\.timed !== 'boolean'\) \{\s*return NextResponse\.json\(\{ error: 'timed must be a boolean' \}, \{ status: 400 \}\);/);
    expect(route).toMatch(/\.\.\.\(typeof body\.timed === 'boolean' \? \{ timed: body\.timed \} : \{\}\),/);
  });
});
