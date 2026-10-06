import { describe, it, expect } from 'vitest';
import { afterCreatePath, draftReviewPath, liveRoundPath, shouldEnterScorerAfterCreate } from '../round-route';

describe('liveRoundPath', () => {
  it('is the /live detail page', () => {
    expect(liveRoundPath('abc')).toBe('/live/abc');
  });
});

describe('shouldEnterScorerAfterCreate', () => {
  // THE REGRESSION TEST for the reported bug. "Go Live takes you into the
  // round" was previously implemented in a parent callback on ONE of the three
  // pages that mount the composer, and the header funnels most routes to a
  // different one — so most users never entered the round. This decision is
  // now keyed only on the created round, so it cannot depend on which page
  // composed it.

  it('sends a freshly created live round to the scorer', () => {
    expect(
      shouldEnterScorerAfterCreate({ id: 'gp1', type: 'golf_round', status: 'pending' })
    ).toBe('/live/gp1');
  });

  it('also handles a round that already advanced to active', () => {
    expect(
      shouldEnterScorerAfterCreate({ id: 'gp1', type: 'golf_round', status: 'active' })
    ).toBe('/live/gp1');
  });

  it('leaves an already-played round alone — it is a post, not a round to play', () => {
    expect(
      shouldEnterScorerAfterCreate({ id: 'gp1', type: 'golf_round', status: 'completed' })
    ).toBeNull();
  });

  it('ignores cancelled rounds', () => {
    expect(
      shouldEnterScorerAfterCreate({ id: 'gp1', type: 'golf_round', status: 'cancelled' })
    ).toBeNull();
  });

  it('ignores non-golf group posts', () => {
    expect(
      shouldEnterScorerAfterCreate({ id: 'gp1', type: 'workout', status: 'pending' })
    ).toBeNull();
  });

  it('keys on the group post id, never post_id', () => {
    // post_id reaches the client through a re-fetch that can silently fail;
    // relying on it turned the whole feature off with no error.
    expect(shouldEnterScorerAfterCreate({ type: 'golf_round', status: 'pending' })).toBeNull();
    expect(
      shouldEnterScorerAfterCreate({ id: null, type: 'golf_round', status: 'pending' })
    ).toBeNull();
  });

  it('is safe on null/undefined', () => {
    expect(shouldEnterScorerAfterCreate(null)).toBeNull();
    expect(shouldEnterScorerAfterCreate(undefined)).toBeNull();
  });
});

describe('afterCreatePath — Finish and Post are two actions (253)', () => {
  it('a live round still goes to the scorer', () => {
    expect(afterCreatePath({ id: 'gp1', type: 'golf_round', status: 'pending', post_id: 'p1' })).toBe('/live/gp1');
  });
  it('an already-played round is a DRAFT: land on it to review and post, never on the feed', () => {
    expect(afterCreatePath({ id: 'gp1', type: 'golf_round', status: 'completed', post_id: 'p1' })).toBe(draftReviewPath('p1'));
    expect(draftReviewPath('p1')).toBe('/feed?post=p1');
  });
  it('stays put without a post to land on, on a cancelled round, and off golf', () => {
    expect(afterCreatePath({ id: 'gp1', type: 'golf_round', status: 'completed', post_id: null })).toBeNull();
    expect(afterCreatePath({ id: 'gp1', type: 'golf_round', status: 'cancelled', post_id: 'p1' })).toBeNull();
    expect(afterCreatePath({ id: 'gp1', type: 'workout', status: 'completed', post_id: 'p1' })).toBeNull();
    expect(afterCreatePath(null)).toBeNull();
  });
});
