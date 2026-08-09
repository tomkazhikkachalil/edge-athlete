import { describe, it, expect } from 'vitest';
import { GROUP_SCORECARD_SELECT, transformGroupPostToScorecard, participantOrder } from '../scorecard-transform';

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

describe('GROUP_SCORECARD_SELECT', () => {
  it('selects post_id — the Live Now strip filters on it', () => {
    // REGRESSION: post_id was missing from this select while
    // /api/golf/live-now did `.filter(r => r.post_id !== null)`. The field was
    // therefore always undefined, every round was filtered out, and the strip
    // rendered nothing on the feed, on Explore, or on /live — for everyone,
    // permanently. TypeScript could not catch it: the transform returns `any`.
    expect(GROUP_SCORECARD_SELECT).toMatch(/(^|[\s,])post_id\s*,/);
  });

  it('carries post_id through the transform onto group_post', () => {
    const out = transformGroupPostToScorecard({
      id: 'gp1',
      post_id: 'feed-post-1',
      status: 'active',
      golf_data: [{ id: 'gd1', course_name: 'Test CC', holes_played: 18 }],
      participants: [],
    });
    expect(out?.group_post.post_id).toBe('feed-post-1');
  });
});

describe('participantOrder — the canonical creation order', () => {
  it('position wins, ascending', () => {
    const rows = [{ position: 2, id: 'a' }, { position: 0, id: 'b' }, { position: 1, id: 'c' }];
    expect(rows.sort(participantOrder).map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('null positions sort AFTER positioned rows (legacy mixed with new)', () => {
    const rows = [{ position: null, id: 'legacy' }, { position: 0, id: 'new' }];
    expect(rows.sort(participantOrder).map(r => r.id)).toEqual(['new', 'legacy']);
  });

  it('legacy rounds: created_at puts the creator first, id breaks the invitee tie', () => {
    // The invitee batch is one INSERT — identical created_at; the creator row
    // is a separate, earlier transaction.
    const rows = [
      { position: null, created_at: '2026-08-01T10:00:05Z', id: 'z-invitee' },
      { position: null, created_at: '2026-08-01T10:00:05Z', id: 'a-invitee' },
      { position: null, created_at: '2026-08-01T10:00:01Z', id: 'creator' },
    ];
    expect(rows.sort(participantOrder).map(r => r.id)).toEqual(['creator', 'a-invitee', 'z-invitee']);
  });

  it('the transform emits participants in canonical order', () => {
    const rows = [
      { ...participant('late', null), position: null, created_at: '2026-08-02T09:00:00Z' },
      { ...participant('second', null), position: 1, created_at: '2026-08-01T10:00:00Z' },
      { ...participant('first', null), position: 0, created_at: '2026-08-01T10:00:00Z' },
    ];
    const out = transformGroupPostToScorecard(raw(rows))!;
    expect(out.participants.map((p: { participant: { id: string } }) => p.participant.id)).toEqual([
      'first', 'second', 'late',
    ]);
  });
});
