import { describe, it, expect } from 'vitest';
import { buildStatsSummary } from '../stats-summary';

// The generic path, exercised through the one public dispatcher.
const formatGenericStatsSummary = (statsData: Record<string, unknown> | null) =>
  buildStatsSummary({ statsData });

describe('formatGenericStatsSummary — workout sessions', () => {
  // The exact payload shape WorkoutEditorScreen writes.
  const workout = (over: Record<string, unknown> = {}) => ({
    type: 'workout_session',
    title: 'Workout',
    top_line: 'Deadlift 300 lbs × 6',
    total_sets: 10,
    exercise_count: 4,
    duration_seconds: 785,
    total_volume_lbs: 13080,
    workout_session_id: '7cd1c200-4886-498d-afee-752a1a411d01',
    ...over,
  });

  it('leads with the pre-formatted top line, not the payload plumbing', () => {
    // Regression: the generic path took the first two OBJECT KEYS and rendered
    // "Type: workout_session • Title: Workout" on the profile tile.
    const s = formatGenericStatsSummary(workout())!;
    expect(s.primaryLine).toBe('Deadlift 300 lbs × 6');
    expect(s.primaryLine).not.toMatch(/workout_session|Type:|Title:/);
  });

  it('summarises the session underneath, capped at three facts', () => {
    const s = formatGenericStatsSummary(workout())!;
    expect(s.secondaryLine).toBe('4 exercises · 10 sets · 13 min');
    expect(s.secondaryLine!.split('·')).toHaveLength(3);
  });

  it('singularises counts of one', () => {
    const s = formatGenericStatsSummary(workout({ exercise_count: 1, total_sets: 1 }))!;
    expect(s.secondaryLine).toContain('1 exercise ·');
    expect(s.secondaryLine).toContain('1 set ');
  });

  it('omits zero and missing aggregates rather than printing "0 sets"', () => {
    const s = formatGenericStatsSummary(
      workout({ total_sets: 0, duration_seconds: 0, total_volume_lbs: null })
    )!;
    expect(s.secondaryLine).toBe('4 exercises');
  });

  it('falls back to the title, then to a single aggregate, when there is no top line', () => {
    expect(formatGenericStatsSummary(workout({ top_line: '' }))!.primaryLine).toBe('Workout');
    const bare = formatGenericStatsSummary(workout({ top_line: '', title: '' }))!;
    expect(bare.primaryLine).toBe('4 exercises');
    // Three facts is the cap; with the first promoted to the headline the
    // remaining three all fit.
    expect(bare.secondaryLine).toBe('10 sets · 13 min · 13,080 lbs');
  });

  it('returns null for a workout with nothing recorded', () => {
    expect(
      formatGenericStatsSummary({ type: 'workout_session', workout_session_id: 'abc' })
    ).toBeNull();
  });
});

describe('formatGenericStatsSummary — generic fallback hygiene', () => {
  it('never surfaces the discriminator or foreign keys', () => {
    const s = formatGenericStatsSummary({
      type: 'vitals_entry',
      vitals_entry_id: 'abc-123',
      metric_label: 'Body Weight',
      value: 182,
    })!;
    expect(s.primaryLine).not.toMatch(/vitals_entry|_id/);
    expect(s.primaryLine).toBe('Metric Label: Body Weight • Value: 182');
  });

  it('skips empty values and nested objects', () => {
    const s = formatGenericStatsSummary({
      type: 'something',
      nested: { a: 1 },
      blank: '',
      missing: null,
      reps: 12,
    })!;
    expect(s.primaryLine).toBe('Reps: 12');
  });

  it('returns null when only plumbing is present', () => {
    expect(formatGenericStatsSummary({ type: 'mystery', mystery_id: 'x' })).toBeNull();
    expect(formatGenericStatsSummary({})).toBeNull();
    expect(formatGenericStatsSummary(null)).toBeNull();
  });
});

describe('buildStatsSummary — golf dispatch', () => {
  it('formats course, score-to-par, holes and the best quick stat', () => {
    const s = buildStatsSummary({
      golfRound: {
        course: 'Eagle Creek', gross_score: 74, par: 72, holes: 18,
        gir_percentage: 61.1, fir_percentage: 50, total_putts: 30,
      },
    });
    expect(s).toEqual({ primaryLine: 'Eagle Creek • 74 (+2)', secondaryLine: '18H • GIR 61%' });
  });

  it('handles even par and the FWY/putts fallbacks', () => {
    expect(buildStatsSummary({ golfRound: { gross_score: 72, par: 72, holes: 18, fir_percentage: 57.2 } }))
      .toEqual({ primaryLine: 'Round • 72 (E)', secondaryLine: '18H • FWY 57%' });
    expect(buildStatsSummary({ golfRound: { course: 'Pines', gross_score: 40, par: 36, holes: 9, total_putts: 16 } }))
      .toEqual({ primaryLine: 'Pines • 40 (+4)', secondaryLine: '9H • 16 putts' });
  });

  it("TaggedTile's narrow shape (no quick stats) degrades to holes only", () => {
    expect(buildStatsSummary({ golfRound: { course: 'Ottawa Hunt', gross_score: 81, par: 72, holes: 18 } }))
      .toEqual({ primaryLine: 'Ottawa Hunt • 81 (+9)', secondaryLine: '18H' });
  });

  it('a golf round without a score falls through to stats_data', () => {
    const s = buildStatsSummary({
      golfRound: { course: 'Eagle Creek' },
      statsData: { type: 'workout_session', top_line: 'Deadlift 300 lbs × 6' },
    });
    expect(s?.primaryLine).toBe('Deadlift 300 lbs × 6');
  });

  it('golf wins over stats_data when both are present', () => {
    const s = buildStatsSummary({
      golfRound: { gross_score: 90, holes: 18 },
      statsData: { type: 'workout_session', top_line: 'nope' },
    });
    expect(s?.primaryLine).toBe('Round • 90');
  });

  it('nothing at all → null', () => {
    expect(buildStatsSummary({})).toBeNull();
    expect(buildStatsSummary({ golfRound: null, statsData: null })).toBeNull();
  });
});
