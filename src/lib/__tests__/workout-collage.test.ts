import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exerciseMedia, exerciseMediaIdAt, moreBadge, roundMedia, roundMediaIdAt, setMediaId, stackBadge, workoutCollageItems } from '../workouts/collage';
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

  // Oct 22 2026 (Training: three changes, item 3): a clip belongs to the
  // exercise, so the caption names the exercise — never the set; a group's
  // keeps the round (the round is the group's shape).
  it('captions name the exercise, or the round and member', () => {
    expect(items[0].label).toBe('Bench Press');
    expect(items[2].label).toBe('Bench Press');
    expect(items[4].label).toBe('Circuit · Round 1 · Row');
    expect(items[5].label).toBe('Circuit · Round 2 · Squat');
    expect(items.some(i => /Set \d/.test(i.label))).toBe(false);
  });

  it('an exercise\'s clips are ONE list, set by set; the strip\'s index finds the viewer id', () => {
    const bench = exercises[0];
    expect(exerciseMedia(bench).map(m => m.url.replace('/api/media/', ''))).toEqual(['a', 'b', 'c']);
    expect(exerciseMediaIdAt(bench, 0)).toBe(setMediaId('bench', 0, 0));
    expect(exerciseMediaIdAt(bench, 1)).toBe(setMediaId('bench', 2, 0));
    expect(exerciseMediaIdAt(bench, 2)).toBe(setMediaId('bench', 2, 1));
    expect(exerciseMediaIdAt(bench, 3)).toBeNull();
    expect(exerciseMediaIdAt(bench, -1)).toBeNull();
    expect(exerciseMedia(ex('dl', 'Deadlift', [set(1), set(2)]))).toEqual([]);
  });

  it('a round\'s clips are ONE list across the members, member by member', () => {
    const members = exercises.slice(1);
    expect(roundMedia(members, 0).map(m => m.url.replace('/api/media/', ''))).toEqual(['r1-squat', 'r1-row']);
    expect(roundMedia(members, 1).map(m => m.url.replace('/api/media/', ''))).toEqual(['r2-squat']);
    expect(roundMedia(members, 5)).toEqual([]);
    expect(roundMediaIdAt(members, 0, 1)).toBe(setMediaId('row', 0, 0));
    expect(roundMediaIdAt(members, 1, 0)).toBe(setMediaId('squat', 1, 0));
    expect(roundMediaIdAt(members, 1, 1)).toBeNull();
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
  it('a strip of three tiles badges only what it cannot show', () => {
    expect(moreBadge(3, 3)).toBeNull();
    expect(moreBadge(4, 3)).toBe('+1');
    expect(moreBadge(2, 3)).toBeNull();
    expect(moreBadge(4, 1)).toBe('+3');
  });
});

describe('set images open the in-app viewer (Oct 17 2026)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('never a link to a new window; the one viewer, portalled', () => {
    for (const f of ['ExerciseMediaStrip', 'GroupDetailCard', 'WorkoutDetailItems', 'WorkoutPostCard', 'WorkoutCard']) {
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
  const fs_exists = (p: string) => existsSync(join(process.cwd(), p));
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
  // Training: three changes (Oct 22 2026, items 2 and 3) — supersedes the Oct 21
  // "uniform set bubbles": ONE inner bubble holds every set; the exercise's
  // clips are ONE strip at its right; nothing per set.
  it('items 2 + 3: one outer bubble per exercise, one inner bubble for all its sets, one strip of 64 px tiles at the right; the same per round', () => {
    const items = read('src/components/workouts/WorkoutDetailItems.tsx');
    expect(items).toMatch(/data-post-sets-bubble=\{item\.exercise\.sets\.length\}/);
    expect(items).toMatch(/\$\{media\.length > 0 \? 'min-h-16' : ''\}/);
    expect(items).toMatch(/<ExerciseMediaStrip media=\{media\} name=\{item\.exercise\.name\}/);
    expect(items).toMatch(/exerciseMediaIdAt\(item\.exercise, i\)/);
    expect(items).not.toMatch(/data-post-set-bubbles|data-post-set-slot|SetImageStack|items-stretch/);
    // A set is a LINE in the bubble — no background, no border of its own.
    expect(items).toMatch(/<p key=\{set\.setNumber\} className="truncate text-xs leading-5 text-tertiary" data-post-set-row=\{set\.setNumber\}>/);
    const strip = read('src/components/workouts/ExerciseMediaStrip.tsx');
    expect(strip).toMatch(/const SHOWN_WIDE = 3;/);
    expect(strip).toMatch(/w-16 h-16 shrink-0 rounded-lg overflow-hidden/);
    expect(strip).toMatch(/flex shrink-0 self-start gap-1" data-post-exercise-media=\{media\.length\}/);
    expect(strip).toMatch(/i === 0 \? '' : 'hidden sm:block'/);
    expect(strip).toMatch(/sm:hidden`\} data-set-image-more=""/);
    expect(strip).toMatch(/hidden sm:block`\} data-set-image-more=""/);
    expect(strip).not.toMatch(/w-14|w-12|w-20/);
    expect(strip).toMatch(/thumbnailUrl=\{m\.thumbnailUrl\}/);
    const group = read('src/components/workouts/GroupDetailCard.tsx');
    expect(group).toMatch(/data-post-round-bubble=\{k \+ 1\}/);
    expect(group).toMatch(/data-post-round-member=\{m\.clientId\}/);
    expect(group).toMatch(/'data-post-round-images': k \+ 1/);
    expect(group).toMatch(/roundMediaIdAt\(members, k, i\)/);
    expect(group).not.toMatch(/SetImageStack|data-post-set-slot|items-stretch/);
    // The group card and its bubbles follow the host's tone (the history card is neutral).
    expect(group).toMatch(/const bubbleClass = tone === 'post' \? 'bg-violet-100\/60 dark:bg-violet-900\/30' : 'bg-surface-muted';/);
    expect(fs_exists('src/components/workouts/SetImageStack.tsx')).toBe(false);
    // The review step and the remove confirm name the exercise, never the set.
    const flow = read('src/components/workouts/FinishFlow.tsx');
    expect(flow).toMatch(/`\$\{clip\.exerciseName\} · clip \$\{ordinal\.n\}` : clip\.exerciseName/);
    expect(flow).not.toMatch(/set \$\{clip\.setNumber\}/);
    expect(read('src/components/workouts/WorkoutEditorScreen.tsx')).toMatch(/It is deleted from \$\{removeClip\.exerciseName\} and from this workout/);
  });
});
