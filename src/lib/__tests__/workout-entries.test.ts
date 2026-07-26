import { describe, it, expect } from 'vitest';
import {
  validateEntriesPayload,
  MAX_EXERCISES,
  MAX_SETS_PER_EXERCISE,
  type EntryExercise,
} from '../workouts/entries';

const validSet = (n = 1) => ({
  setNumber: n,
  reps: 5,
  weight: 185,
  weightUnit: 'lbs',
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: '2026-07-26T12:00:00.000Z',
});

const validExercise = (name = 'Bench Press'): Record<string, unknown> => ({
  name,
  exerciseKey: 'bench_press',
  category: 'strength',
  notes: null,
  sets: [validSet(1), validSet(2)],
});

describe('validateEntriesPayload', () => {
  it('accepts a valid payload and normalizes it', () => {
    const result = validateEntriesPayload([validExercise()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exercises).toHaveLength(1);
      expect(result.exercises[0].sets).toHaveLength(2);
      expect(result.exercises[0].name).toBe('Bench Press');
    }
  });

  it('accepts an empty exercise list and null-heavy sets', () => {
    expect(validateEntriesPayload([]).ok).toBe(true);
    const cardio = {
      ...validExercise('Run'),
      category: 'cardio',
      sets: [{ setNumber: 1, reps: null, weight: null, weightUnit: null, durationSeconds: 1800, distance: 3.1, distanceUnit: 'mi', completedAt: null }],
    };
    expect(validateEntriesPayload([cardio]).ok).toBe(true);
  });

  it('rejects non-array and malformed shapes', () => {
    expect(validateEntriesPayload('nope').ok).toBe(false);
    expect(validateEntriesPayload([null]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: 'x' }]).ok).toBe(false);
  });

  it('enforces the exercise and set caps', () => {
    const tooManyExercises = Array.from({ length: MAX_EXERCISES + 1 }, () => validExercise());
    expect(validateEntriesPayload(tooManyExercises).ok).toBe(false);

    const tooManySets = {
      ...validExercise(),
      sets: Array.from({ length: MAX_SETS_PER_EXERCISE + 1 }, (_, i) => validSet(Math.min(i + 1, 99))),
    };
    expect(validateEntriesPayload([tooManySets]).ok).toBe(false);
  });

  it('rejects out-of-range numbers and bad enums', () => {
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), weight: -5 }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), weight: 6000 }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), reps: 2000 }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), weightUnit: 'stone' }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), category: 'esports' }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), setNumber: 0 }] }]).ok).toBe(false);
  });

  it('rejects oversize strings', () => {
    expect(validateEntriesPayload([{ ...validExercise('x'.repeat(81)) }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), notes: 'x'.repeat(501) }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(''), name: '' }]).ok).toBe(false);
  });

  it('produces typed EntryExercise output usable downstream', () => {
    const result = validateEntriesPayload([validExercise()]);
    if (result.ok) {
      const exercises: EntryExercise[] = result.exercises;
      expect(exercises[0].exerciseKey).toBe('bench_press');
    }
  });

  describe('set media', () => {
    const withMedia = (media: unknown) => [
      { ...validExercise(), sets: [{ ...validSet(), media }] },
    ];

    it('absent media normalizes to [] (pre-046 snapshots stay valid)', () => {
      const result = validateEntriesPayload([validExercise()]);
      expect(result.ok && result.exercises[0].sets[0].media).toEqual([]);
    });

    it('accepts valid https media up to the cap', () => {
      const media = [
        { url: 'https://x.supabase.co/storage/v1/clip.mp4', type: 'video' },
        { url: 'https://x.supabase.co/storage/v1/pic.jpg', type: 'image' },
      ];
      const result = validateEntriesPayload(withMedia(media));
      expect(result.ok && result.exercises[0].sets[0].media).toHaveLength(2);
    });

    it('rejects more than 4 items per set', () => {
      const media = Array.from({ length: 5 }, (_, i) => ({
        url: `https://x/clip${i}.mp4`,
        type: 'video',
      }));
      expect(validateEntriesPayload(withMedia(media)).ok).toBe(false);
    });

    it('rejects bad URLs and bad types', () => {
      expect(validateEntriesPayload(withMedia([{ url: 'javascript:alert(1)', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: 'http://insecure/x.jpg', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: 'https://x/y.gif', type: 'gif' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: '', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia(['nope'])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia('nope')).ok).toBe(false);
    });
  });
});
