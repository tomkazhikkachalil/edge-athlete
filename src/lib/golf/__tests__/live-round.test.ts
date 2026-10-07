import { describe, it, expect } from 'vitest';
import { pickLiveRound, type LiveRoundRow } from '../live-round';

const NOW = Date.parse('2026-07-24T18:00:00Z');

const row = (id: string, status: string, date: string, participant = `part-${id}`): LiveRoundRow => ({
  participant_id: participant,
  group_post: { id, status, date, post_id: `post-${id}`, course_name: 'Pebble' },
});

describe('pickLiveRound', () => {
  it('returns null with no rounds or no live rounds', () => {
    expect(pickLiveRound([], NOW)).toBeNull();
    expect(pickLiveRound([row('b', 'completed', '2026-07-24')], NOW)).toBeNull();
    expect(pickLiveRound([row('c', 'cancelled', '2026-07-24')], NOW)).toBeNull();
  });

  it('returns an active round dated today', () => {
    expect(pickLiveRound([row('a', 'active', '2026-07-24')], NOW)?.group_post.id).toBe('a');
  });

  it('returns a PENDING round in its window — the zero-score session must get its resume banner (dummy-proofing round)', () => {
    expect(pickLiveRound([row('a', 'pending', '2026-07-24')], NOW)?.group_post.id).toBe('a');
    // …and still after its LIVE window: in progress until the creator settles
    // it or the 7-day sweep discards it (Drafts round).
    expect(pickLiveRound([row('old', 'pending', '2026-07-19')], NOW)?.group_post.id).toBe('old');
  });

  it('keeps active rounds outside the ±48h LIVE window — in progress is in progress', () => {
    expect(pickLiveRound([row('old', 'active', '2026-07-19')], NOW)?.group_post.id).toBe('old');
  });

  it('prefers the most recent when several are live', () => {
    const picked = pickLiveRound(
      [row('older', 'active', '2026-07-23'), row('newer', 'active', '2026-07-24')],
      NOW
    );
    expect(picked?.group_post.id).toBe('newer');
  });

  it('survives malformed rows', () => {
    const noDate = { participant_id: 'p', group_post: { id: 'x', status: 'active', date: null } } as LiveRoundRow;
    expect(pickLiveRound([noDate], NOW)?.group_post.id).toBe('x');
    const noGroup = { participant_id: 'p', group_post: null } as unknown as LiveRoundRow;
    expect(pickLiveRound([noGroup], NOW)).toBeNull();
  });

  it('excludes a round whose own card is already complete', () => {
    // Round stays 'active' until the SLOWEST player finishes — a player who
    // finished 18/18 has nothing to resume and must not see the banner.
    const done = {
      ...row('a', 'active', '2026-07-24'),
      holes_completed: 18,
      group_post: { ...row('a', 'active', '2026-07-24').group_post, holes_played: 18 },
    };
    expect(pickLiveRound([done], NOW)).toBeNull();
  });

  it('keeps a mid-card round, and rounds with unknown completion', () => {
    const base = row('a', 'active', '2026-07-24');
    const midCard = {
      ...base,
      holes_completed: 9,
      group_post: { ...base.group_post, holes_played: 18 },
    };
    expect(pickLiveRound([midCard], NOW)?.group_post.id).toBe('a');
    // No scores row yet (holes_completed null) → still resumable
    const noScores = {
      ...base,
      holes_completed: null,
      group_post: { ...base.group_post, holes_played: 18 },
    };
    expect(pickLiveRound([noScores], NOW)?.group_post.id).toBe('a');
    // Legacy row without holes_played → never suppress on unknown length
    expect(pickLiveRound([{ ...base, holes_completed: 18 }], NOW)?.group_post.id).toBe('a');
  });

  it('offers a round however quiet and however old — there is no quiet rule and no window here (Drafts round)', () => {
    const base = row('a', 'active', '2026-07-01');
    const quiet = { ...base, group_post: { ...base.group_post, last_score_activity_at: new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString() } };
    expect(pickLiveRound([quiet], NOW)?.group_post.id).toBe('a');
  });

  it('falls through to an unfinished round when the newest card is done', () => {
    const doneBase = row('newer', 'active', '2026-07-24');
    const done = {
      ...doneBase,
      holes_completed: 9,
      group_post: { ...doneBase.group_post, holes_played: 9 },
    };
    const open = {
      ...row('older', 'active', '2026-07-23'),
      holes_completed: 3,
      group_post: { ...row('older', 'active', '2026-07-23').group_post, holes_played: 18 },
    };
    expect(pickLiveRound([done, open], NOW)?.group_post.id).toBe('older');
  });
});
