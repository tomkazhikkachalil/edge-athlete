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
  // Training: three changes (Oct 22 2026) — Training's Start offers Workout or
  // Activity; the rows are the Create sheet's, so the two doors cannot differ.
  it('Training\'s Start opens the Workout | Activity sheet; its rows are the Create sheet\'s; Workout is the route, Activity the recorder', () => {
    const rows = code('src/components/workouts/StartSessionRows.tsx');
    expect(rows).toMatch(/data-create-workout=""/);
    expect(rows).toMatch(/data-create-recording=""/);
    expect(rows).toMatch(/'data-training-record-activity': ''/);
    expect(rows).toMatch(/>Workout<\/span>/);
    expect(rows).toMatch(/>Activity<\/span>/);
    const sheet = code('src/components/workouts/StartSessionSheet.tsx');
    expect(sheet).toMatch(/windowKey="start-session"/);
    expect(sheet).toMatch(/<StartSessionRows onWorkout=\{onWorkout\} onActivity=\{onActivity\} trainingDoor \/>/);
    const create = code('src/components/CreateSheet.tsx');
    expect(create).toMatch(/<StartSessionRows onWorkout=\{onWorkout\} onActivity=\{onRecording\} \/>/);
    expect(create).not.toMatch(/Start a workout|Record activity</);
    const training = code('src/components/TrainingTab.tsx');
    expect(training).toMatch(/onWorkout=\{\(\) => \{ setShowStartSheet\(false\); openStartWorkout\(\); \}\}/);
    expect(training).toMatch(/onActivity=\{\(\) => \{ setShowStartSheet\(false\); router\.push\('\/activities\/record'\); \}\}/);
    // The one Start: no separate Record Activity pill, no direct start door.
    expect(training).not.toMatch(/Record Activity\s*<\/button>|Start Workout\s*<\/button>|Start Your First Workout/);
    expect((training.match(/data-training-start=""/g) ?? []).length).toBe(2);
  });
  it('the screen writes nothing before Start: no fetch of its own but the hook\'s; the CTA is fixed; the clock choice is remembered', () => {
    const screen = code('src/components/workouts/WorkoutStartScreen.tsx');
    expect(screen).not.toMatch(/fetch\(/);
    expect(screen).toMatch(/data-workout-start=""/);
    expect(screen).toMatch(/writeTimedDefault\(timed\);\s*void start\(routineId, \{ title, timed \}\);/);
    expect(screen).toMatch(/data-workout-start-in-progress=\{inProgress\.id\}/);
    expect(screen).toMatch(/data-workout-start-timed=\{timed \? 'on' : 'off'\}/);
    // Start waits for hydration (Oct 20 2026: a pre-hydration tap on production did nothing).
    expect(screen).toMatch(/disabled=\{starting \|\| !hydrated\}/);
    expect(code('src/hooks/useHydrated.ts')).toMatch(/useSyncExternalStore\(subscribe, \(\) => true, \(\) => false\)/);
    expect(TIMED_DEFAULT_KEY).toBe('ea:workout:timed-default:v1');
  });
  it('the live branch validates `timed` before any state check and writes it on the insert', () => {
    const route = code('src/app/api/workouts/route.ts');
    expect(route).toMatch(/if \(body\.timed !== undefined && typeof body\.timed !== 'boolean'\) \{\s*return NextResponse\.json\(\{ error: 'timed must be a boolean' \}, \{ status: 400 \}\);/);
    expect(route).toMatch(/\.\.\.\(typeof body\.timed === 'boolean' \? \{ timed: body\.timed \} : \{\}\),/);
  });
});
