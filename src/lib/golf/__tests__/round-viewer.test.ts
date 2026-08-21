import { describe, it, expect } from 'vitest';
import { resolveRoundEntry, type ViewerScorecard } from '../round-viewer';

const ME = 'me';
const NOW = Date.parse('2026-08-01T12:00:00Z');

const card = (over: Partial<ViewerScorecard> = {}): ViewerScorecard => ({
  group_post: {
    id: 'gp1',
    creator_id: ME,
    status: 'active',
    date: '2026-08-01',
    post_id: 'post1',
    last_score_activity_at: '2026-08-01T11:50:00Z',
  },
  golf_data: { holes_played: 18 },
  participants: [
    { participant: { id: 'p-me', profile_id: ME, status: 'confirmed' }, scores: { holes_completed: 3 } },
  ],
  ...over,
});

describe('resolveRoundEntry', () => {
  it('scores an active participant mid-round', () => {
    const out = resolveRoundEntry({ scorecard: card(), viewerId: ME, now: NOW });
    expect(out).toEqual({ mode: 'score', participantId: 'p-me', isCreator: true, postId: 'post1' });
  });

  it('is not-found for a missing or untransformable round', () => {
    expect(resolveRoundEntry({ scorecard: null, viewerId: ME, now: NOW })).toEqual({
      mode: 'not-found',
    });
    expect(resolveRoundEntry({ scorecard: undefined, viewerId: ME, now: NOW })).toEqual({
      mode: 'not-found',
    });
  });

  it('is final once the round completes — active participant keeps a repair handle', () => {
    const out = resolveRoundEntry({
      scorecard: card({ group_post: { ...card().group_post, status: 'completed' } }),
      viewerId: ME,
      now: NOW,
    });
    // Same policy the feed card has always had: canScore carries no status
    // gate, so an active participant may still fix a score on a final round.
    expect(out).toEqual({ mode: 'final', postId: 'post1', participantId: 'p-me', isCreator: true });
  });

  it('final round: spectators and declined participants get no repair handle', () => {
    const completed = { ...card().group_post, status: 'completed' };
    expect(
      resolveRoundEntry({ scorecard: card({ group_post: completed }), viewerId: 'someone-else', now: NOW })
    ).toEqual({ mode: 'final', postId: 'post1', participantId: null, isCreator: false });
    expect(
      resolveRoundEntry({
        scorecard: card({
          group_post: completed,
          participants: [
            { participant: { id: 'p-me', profile_id: ME, status: 'declined' }, scores: null },
          ],
        }),
        viewerId: ME,
        now: NOW,
      })
    ).toEqual({ mode: 'final', postId: 'post1', participantId: null, isCreator: true });
  });

  it('cancelled rounds have nothing to fix — no repair handle for anyone', () => {
    const out = resolveRoundEntry({
      scorecard: card({ group_post: { ...card().group_post, status: 'cancelled' } }),
      viewerId: ME,
      now: NOW,
    });
    expect(out).toEqual({ mode: 'final', postId: 'post1', participantId: null, isCreator: true });
  });

  it('defers to effectiveRoundStatus, so a round quiet past the auto-end window is final', () => {
    // Still says 'active' in the row, but nobody has scored in ~7h. The screen
    // must not offer a scorer for a round the rest of the app calls finished.
    const out = resolveRoundEntry({
      scorecard: card({
        group_post: {
          ...card().group_post,
          status: 'active',
          last_score_activity_at: '2026-08-01T05:00:00Z',
        },
      }),
      viewerId: ME,
      now: NOW,
    });
    expect(out.mode).toBe('final');
  });

  it('lets a non-participant watch rather than 403 — public live rounds are watchable', () => {
    const out = resolveRoundEntry({ scorecard: card(), viewerId: 'someone-else', now: NOW });
    expect(out).toEqual({ mode: 'watch', reason: 'spectator', postId: 'post1' });
  });

  it('treats a signed-out viewer as a spectator', () => {
    expect(resolveRoundEntry({ scorecard: card(), viewerId: null, now: NOW })).toEqual({
      mode: 'watch',
      reason: 'spectator',
      postId: 'post1',
    });
  });

  it('lets a declined participant watch, but not score', () => {
    const out = resolveRoundEntry({
      scorecard: card({
        participants: [
          { participant: { id: 'p-me', profile_id: ME, status: 'declined' }, scores: null },
        ],
      }),
      viewerId: ME,
      now: NOW,
    });
    expect(out).toEqual({ mode: 'watch', reason: 'declined', postId: 'post1' });
  });

  it('does not reopen the scorer once your own card is complete', () => {
    // The ROUND stays live for slower players; you have nothing left to enter.
    const out = resolveRoundEntry({
      scorecard: card({
        participants: [
          {
            participant: { id: 'p-me', profile_id: ME, status: 'confirmed' },
            scores: { holes_completed: 18 },
          },
        ],
      }),
      viewerId: ME,
      now: NOW,
    });
    expect(out).toEqual({ mode: 'watch', reason: 'card-complete', postId: 'post1' });
  });

  it('reports isCreator false for a non-creator participant', () => {
    const out = resolveRoundEntry({
      scorecard: card({ group_post: { ...card().group_post, creator_id: 'someone-else' } }),
      viewerId: ME,
      now: NOW,
    });
    expect(out).toMatchObject({ mode: 'score', isCreator: false });
  });

  it('carries a null postId through rather than failing', () => {
    // A round whose feed-post backfill failed must still be enterable.
    const out = resolveRoundEntry({
      scorecard: card({ group_post: { ...card().group_post, post_id: null } }),
      viewerId: ME,
      now: NOW,
    });
    expect(out).toMatchObject({ mode: 'score', postId: null });
  });
});
