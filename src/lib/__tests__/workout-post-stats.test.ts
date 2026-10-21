import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workoutPostStatsFromSession } from '../workouts/post-stats';
import type { ServerWorkoutSession } from '../workouts/serialize';

// Training fixes PR 5 (Oct 21 2026): a posted workout can be edited from the
// post's menu, and the post's summary follows the session — rebuilt from the
// rows, the confirmed records kept.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const set = (n: number, reps: number, weight: number) => ({ set_number: n, reps, weight, weight_unit: 'lbs', duration_seconds: null, distance: null, distance_unit: null, completed_at: null, media: [], rest_seconds: null });
const session = (over: Partial<ServerWorkoutSession> = {}): ServerWorkoutSession => ({
  id: 'w1', profile_id: 'u1', status: 'completed', title: 'Push day', started_at: '2026-10-21T08:00:00Z', ended_at: '2026-10-21T08:45:00Z', duration_seconds: 2700, timed: true, post_id: 'p1', notes: null,
  exercises: [{ id: 'e1', client_id: 'c1', name: 'Bench Press', exercise_key: 'bench_press', category: 'strength', position: 0, notes: null, sets: [set(1, 8, 100), set(2, 8, 100)] }],
  ...over,
} as unknown as ServerWorkoutSession);

describe('a posted workout\'s summary from its session', () => {
  it('rebuilds the counts, the volume and the top line; keeps the confirmed records; omits the time when untimed', () => {
    const next = workoutPostStatsFromSession(session(), { type: 'workout_session', prs: [{ label: 'Bench 1RM', display: '125 lbs' }, { bad: true }] })!;
    expect(next).toMatchObject({ type: 'workout_session', workout_session_id: 'w1', title: 'Push day', duration_seconds: 2700, exercise_count: 1, total_sets: 2, total_volume_lbs: 1600 });
    expect(next.prs).toEqual([{ label: 'Bench 1RM', display: '125 lbs' }]);
    const untimed = workoutPostStatsFromSession(session({ timed: false, duration_seconds: null }), null)!;
    expect(untimed).not.toHaveProperty('duration_seconds');
    expect(untimed).not.toHaveProperty('prs');
    expect(workoutPostStatsFromSession(session({ status: 'active' }), null)).toBeNull();
  });
  it('the routes refresh the post after an entries PUT or a title PATCH on a posted, completed session; the owner menu offers Edit workout', () => {
    const entries = read('src/app/api/workouts/[id]/entries/route.ts');
    expect(entries.match(/if \(session\.status === 'completed' && session\.post_id\) await refreshWorkoutPostStats\(getSupabaseAdmin\(\), id\);/g)?.length).toBe(2);
    expect(entries).toMatch(/\.select\('profile_id, status, last_activity_at, post_id'\)/);
    const one = read('src/app/api/workouts/[id]/route.ts');
    expect(one).toMatch(/if \(body\.title !== undefined && updated\?\.post_id && updated\.status === 'completed'\) await refreshWorkoutPostStats\(supabase, id\);/);
    const server = read('src/lib/workouts/post-stats-server.ts');
    expect(server).toMatch(/\.update\(\{ stats_data: next \}\)\.eq\('id', post\.id\)\.eq\('profile_id', session\.profile_id\)/);
    expect(server).toMatch(/if \(!post \|\| post\.profile_id !== session\.profile_id\) return;/);
    const menu = read('src/components/PostOwnerMenu.tsx');
    expect(menu).toMatch(/key: 'edit-workout', label: 'Edit workout'/);
    const card = read('src/components/PostCard.tsx');
    expect(card).toMatch(/onEditWorkout=\{typeof post\.stats_data\?\.workout_session_id === 'string' && post\.stats_data\.type === 'workout_session' \? \(\) => router\.push\(`\/app\/workout\/\$\{post\.stats_data!\.workout_session_id as string\}`\) : undefined\}/);
  });
});
