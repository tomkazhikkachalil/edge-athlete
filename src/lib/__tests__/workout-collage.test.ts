import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setMediaId, stackBadge, workoutCollageItems } from '../workouts/collage';
import type { EntryExercise, EntrySet, SetMedia } from '../workouts/entries';

const photo = (n: string): SetMedia => ({ url: `/api/media/${n}`, type: 'image' });
const clip = (n: string): SetMedia => ({ url: `/api/media/${n}`, type: 'video', thumbnailUrl: `/api/media/${n}-poster` });
const set = (n: number, media: SetMedia[] = []): EntrySet => ({ setNumber: n, reps: 8, weight: 135, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media });
const ex = (clientId: string, name: string, sets: EntrySet[], group?: { id: string; kind: 'circuit' | 'superset'; rounds: number }): EntryExercise => ({
  clientId, name, exerciseKey: null, category: 'strength', notes: null, sets,
  ...(group ? { groupId: group.id, groupKind: group.kind, groupRounds: group.rounds } : {}),
} as EntryExercise);

describe('a posted workout\'s images, in reading order', () => {
  const circuit = { id: 'g1', kind: 'circuit' as const, rounds: 2 };
  const exercises = [
    ex('bench', 'Bench Press', [set(1, [photo('a')]), set(2), set(3, [photo('b'), clip('c')])]),
    ex('squat', 'Squat', [set(1, [photo('r1-squat')]), set(2, [photo('r2-squat')])], circuit),
    ex('row', 'Row', [set(1, [photo('r1-row')]), set(2)], circuit),
  ];
  const items = workoutCollageItems(exercises);

  it('single sets in order, then the circuit round by round (each round\'s members in order)', () => {
    expect(items.map(i => i.url.replace('/api/media/', ''))).toEqual(['a', 'b', 'c', 'r1-squat', 'r1-row', 'r2-squat']);
  });

  it('captions name the exercise and set, or the round', () => {
    expect(items[0].label).toBe('Bench Press · Set 1');
    expect(items[2].label).toBe('Bench Press · Set 3');
    expect(items[4].label).toBe('Circuit · Round 1 · Row');
    expect(items[5].label).toBe('Circuit · Round 2 · Squat');
  });

  it('a video keeps its poster and plays as a video; ids find the tapped image', () => {
    expect(items[2]).toMatchObject({ kind: 'video', thumbnailUrl: '/api/media/c-poster' });
    expect(items[0].thumbnailUrl).toBeNull();
    expect(items.findIndex(i => i.id === setMediaId('bench', 2, 0))).toBe(1);
    expect(items.findIndex(i => i.id === setMediaId('row', 0, 0))).toBe(4);
  });

  it('a workout without images has none', () => {
    expect(workoutCollageItems([ex('dl', 'Deadlift', [set(1), set(2)])])).toEqual([]);
  });
});

describe('the stack badge', () => {
  it('one image has none; several say how many more', () => {
    expect(stackBadge(1)).toBeNull();
    expect(stackBadge(2)).toBe('+1');
    expect(stackBadge(4)).toBe('+3');
  });
});

describe('set images open the in-app viewer (Oct 17 2026)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('never a link to a new window; the one viewer, portalled', () => {
    for (const f of ['SetImageStack', 'GroupDetailCard', 'WorkoutDetailItems', 'WorkoutPostCard', 'WorkoutCard']) {
      expect(read(`src/components/workouts/${f}.tsx`), f).not.toMatch(/target="_blank"/);
    }
    const host = read('src/components/workouts/WorkoutDetailItems.tsx');
    expect(host).toMatch(/<MediaLightbox/);
    expect(host).toMatch(/createPortal\(/);
  });
});

// ── Training fixes, Oct 21 2026 (items 1–3): the posted workout's look ───────
describe('the posted workout\'s look (Oct 21 2026)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('item 1: inside the expanded post the fill is the page background; the card, bar and exercise cards stay violet', () => {
    const post = read('src/components/workouts/WorkoutPostCard.tsx');
    expect(post).toMatch(/data-post-workout-details=""/);
    expect(post).toMatch(/border-violet-100 dark:border-violet-900 bg-canvas space-y-3/);
    expect(post).not.toMatch(/bg-surface\/60/);
    expect(post).toMatch(/bg-brand-soft\/60 overflow-hidden/);
    const items = read('src/components/workouts/WorkoutDetailItems.tsx');
    expect(items).toMatch(/bg-violet-50\/30 dark:bg-violet-950\/20/);
  });
  it('item 2: an untimed workout shows two tiles and no "Not timed" — the post and the summary alike', () => {
    const post = read('src/components/workouts/WorkoutPostCard.tsx');
    expect(post).toMatch(/durationSeconds === null \? 'grid-cols-2' : 'grid-cols-3'/);
    expect(post).toMatch(/\{durationSeconds !== null && \(/);
    expect(post).not.toMatch(/Not timed/);
    const flow = read('src/components/workouts/FinishFlow.tsx');
    expect(flow).toMatch(/durationSeconds === null \? 'grid-cols-2' : 'grid-cols-3'/);
    expect(flow).not.toMatch(/Not timed/);
    // The specs read ONE [data-summary-duration]: it lives on the grid, not on a tile.
    expect(flow.match(/data-summary-duration=/g)?.length).toBe(1);
    expect(flow).toMatch(/gap-3 \$\{durationSeconds === null \? 'grid-cols-2' : 'grid-cols-3'\}`\} data-summary-duration=\{durationSeconds \?\? 'untimed'\}/);
  });
  it('item 3: every set is a bubble; a 64 px thumb at its right; an empty slot keeps the lines aligned; one thumb size', () => {
    const items = read('src/components/workouts/WorkoutDetailItems.tsx');
    expect(items).toMatch(/data-post-set-bubbles=/);
    expect(items).toMatch(/flex items-stretch gap-2" data-post-set-row=/);
    expect(items).toMatch(/withMedia \? 'min-h-16' : 'py-1\.5'/);
    expect(items).toMatch(/<span className="w-16 shrink-0" aria-hidden="true" data-post-set-slot="" \/>/);
    const stack = read('src/components/workouts/SetImageStack.tsx');
    expect(stack).toMatch(/'w-16 h-16' : 'w-16 h-16'/);
    expect(stack).not.toMatch(/w-14|w-12/);
    const group = read('src/components/workouts/GroupDetailCard.tsx');
    expect(group).toMatch(/data-post-round-member=/);
    expect(group).toMatch(/'data-post-round-images': k \+ 1/);
    expect(group).not.toMatch(/const roundImages/);
    expect(group).toMatch(/withMedia \? 'min-h-16' : 'py-1\.5'/);
  });
});
