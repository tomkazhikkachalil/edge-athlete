import { describe, it, expect } from 'vitest';
import { transformGroupPostToScorecard } from '../scorecard-transform';

const raw = (participants: unknown[]) => ({
  id: 'gp1',
  status: 'active',
  golf_data: [{ id: 'gd1', course_name: 'Test CC', holes_played: 18 }],
  participants,
});

const participant = (id: string, updated_at: string | null) => ({
  id,
  profile_id: `profile-${id}`,
  status: 'confirmed',
  profile: { id: `profile-${id}` },
  scores: updated_at
    ? [{ id: `s-${id}`, total_score: 40, to_par: 4, holes_completed: 9, scores_confirmed: true, updated_at, hole_scores: [] }]
    : [],
});

describe('transformGroupPostToScorecard — last_score_activity_at', () => {
  it('is the max updated_at across participants', () => {
    const result = transformGroupPostToScorecard(
      raw([
        participant('a', '2026-07-25T10:00:00+00:00'),
        participant('b', '2026-07-25T14:30:00+00:00'),
        participant('c', '2026-07-25T12:00:00+00:00'),
      ])
    );
    expect(result.group_post.last_score_activity_at).toBe('2026-07-25T14:30:00+00:00');
  });

  it('is null when no participant has a scores row', () => {
    const result = transformGroupPostToScorecard(raw([participant('a', null)]));
    expect(result.group_post.last_score_activity_at).toBeNull();
    // Empty-scores stub keeps a consistent shape
    expect(result.participants[0].scores.updated_at).toBeNull();
    expect(result.participants[0].scores.holes_completed).toBe(0);
  });

  it('still returns null for rows without golf data', () => {
    expect(transformGroupPostToScorecard({ id: 'x', golf_data: [], participants: [] })).toBeNull();
  });
});
