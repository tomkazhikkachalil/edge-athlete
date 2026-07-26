import { describe, it, expect } from 'vitest';
import { parseDraft, resolveEntries, DRAFT_TTL_MS, type WorkoutDraft } from '../workouts/draft';
import type { EntryExercise } from '../workouts/entries';

const exercises: EntryExercise[] = [
  { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [] },
];

const NOW = 1_800_000_000_000;

const draft = (over: Partial<WorkoutDraft> = {}): string =>
  JSON.stringify({
    v: 1,
    sessionId: 'abc',
    savedAt: NOW - 1000,
    title: 'Push Day',
    exercises,
    ...over,
  });

describe('parseDraft', () => {
  it('parses a valid draft', () => {
    const parsed = parseDraft(draft(), 'abc', NOW);
    expect(parsed?.title).toBe('Push Day');
    expect(parsed?.exercises).toHaveLength(1);
  });

  it('rejects garbage, null, wrong session, wrong version', () => {
    expect(parseDraft(null, 'abc', NOW)).toBeNull();
    expect(parseDraft('{not json', 'abc', NOW)).toBeNull();
    expect(parseDraft(draft(), 'other-session', NOW)).toBeNull();
    expect(parseDraft(draft({ v: 2 as unknown as 1 }), 'abc', NOW)).toBeNull();
    expect(parseDraft(draft({ exercises: 'x' as unknown as EntryExercise[] }), 'abc', NOW)).toBeNull();
  });

  it('expires after the TTL', () => {
    expect(parseDraft(draft({ savedAt: NOW - DRAFT_TTL_MS - 1 }), 'abc', NOW)).toBeNull();
    expect(parseDraft(draft({ savedAt: NOW - DRAFT_TTL_MS + 1000 }), 'abc', NOW)).not.toBeNull();
  });
});

describe('resolveEntries', () => {
  const serverExercises: EntryExercise[] = [
    { name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, sets: [] },
  ];
  const parsed = (savedAt: number): WorkoutDraft => ({
    v: 1,
    sessionId: 'abc',
    savedAt,
    title: 'Push Day',
    exercises,
  });

  it('draft strictly newer than the server wins', () => {
    const result = resolveEntries(serverExercises, NOW - 5000, parsed(NOW - 1000));
    expect(result.fromDraft).toBe(true);
    expect(result.exercises[0].name).toBe('Bench Press');
    expect(result.title).toBe('Push Day');
  });

  it('server newer or tied wins (durably acknowledged side)', () => {
    expect(resolveEntries(serverExercises, NOW, parsed(NOW - 1000)).fromDraft).toBe(false);
    expect(resolveEntries(serverExercises, NOW, parsed(NOW)).fromDraft).toBe(false);
  });

  it('null draft falls through to server', () => {
    const result = resolveEntries(serverExercises, NOW, null);
    expect(result.fromDraft).toBe(false);
    expect(result.exercises[0].name).toBe('Squat');
  });
});
