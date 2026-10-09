import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Workout capture round PR 4 (Oct 9 2026 — migration 256): concurrent
// entries PUTs for the same session never duplicate its exercises. The
// editor's debounced save and the keepalive flush a reload fires used to
// both pass the stale-write guard and both delete + reinsert — the athlete
// came back to every exercise twice (the capture spec's production probe
// caught it). The replace is one transaction now, serialized per session.

const exercise = (name: string) => ({
  name, exerciseKey: null, category: 'strength', notes: null,
  sets: [{ setNumber: 1, reps: 5, weight: 100, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] }],
});

test('eight concurrent entries PUTs leave exactly one copy of the snapshot', async ({}) => {
  test.setTimeout(90_000);
  const api = await apiAs('state.json');
  let workoutId: string | null = null;
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.status(), await readErrorBody(started)).toBe(201);
    workoutId = (await started.json()).session.id as string;

    // Eight snapshots, each of TWO exercises, distinct savedAt values, fired at once.
    const base = Date.now();
    const puts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api.put(`/api/workouts/${workoutId}/entries`, {
          data: { savedAt: base + i, exercises: [exercise(`Squat ${i}`), exercise(`Row ${i}`)] },
        })
      )
    );
    for (const r of puts) expect(r.ok(), await readErrorBody(r)).toBe(true);

    // Whichever snapshot won, the session holds exactly TWO exercises — never four, six, sixteen.
    const read = await api.get(`/api/workouts/${workoutId}`);
    expect(read.ok(), await readErrorBody(read)).toBe(true);
    const exercises = (await read.json()).session.exercises as Array<{ name: string; sets: unknown[] }>;
    expect(exercises).toHaveLength(2);
    expect(exercises.every(e => e.sets.length === 1)).toBe(true);
    // Both exercises come from the SAME snapshot (one suffix), never a mix.
    const suffixes = new Set(exercises.map(e => e.name.split(' ')[1]));
    expect(suffixes.size).toBe(1);
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    await api.dispose();
  }
});
