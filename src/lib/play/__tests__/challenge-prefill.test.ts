import { describe, expect, it } from 'vitest';
import { challengePrefillFor } from '../challenge-prefill';

describe('challengePrefillFor — "beat my …" from your own result', () => {
  it('a golf round: its score, length and course', () => {
    expect(challengePrefillFor({ id: 'p', golf_round: { id: 'r1', gross_score: 78, holes: 18, course: 'Eagle Creek' } })).toEqual({
      sportKey: 'golf',
      prefill: { metric: 'gross', target: 78, holes: 18, sourceKey: 'golf_round:r1', courseName: 'Eagle Creek' },
    });
  });
  it('a stat line: its headline stat that was recorded', () => {
    const p = challengePrefillFor({ id: 'p1', stats_data: { type: 'stat_line', sport_key: 'basketball', stats: { points: 22, rebounds: 4 } } });
    expect(p?.sportKey).toBe('basketball');
    expect(p?.prefill.sourceKey).toBe('post:p1');
    expect(p?.prefill.target).toBeGreaterThan(0);
  });
  it('nothing for a pending post, a workout, an empty line, or an unscored round', () => {
    expect(challengePrefillFor({ id: 'p', status: 'pending_approval', golf_round: { gross_score: 80 } })).toBeNull();
    expect(challengePrefillFor({ id: 'p', stats_data: { type: 'workout_session' } })).toBeNull();
    expect(challengePrefillFor({ id: 'p', stats_data: { type: 'stat_line', sport_key: 'basketball', stats: { points: 0 } } })).toBeNull();
    expect(challengePrefillFor({ id: 'p', golf_round: { gross_score: 0 } })).toBeNull();
  });
});
