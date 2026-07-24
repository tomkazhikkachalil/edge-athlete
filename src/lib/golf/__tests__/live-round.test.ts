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
    expect(pickLiveRound([row('a', 'pending', '2026-07-24')], NOW)).toBeNull();
    expect(pickLiveRound([row('b', 'completed', '2026-07-24')], NOW)).toBeNull();
  });

  it('returns an active round dated today', () => {
    expect(pickLiveRound([row('a', 'active', '2026-07-24')], NOW)?.group_post.id).toBe('a');
  });

  it('excludes active rounds outside the ±48h live window', () => {
    expect(pickLiveRound([row('old', 'active', '2026-07-19')], NOW)).toBeNull();
  });

  it('prefers the most recent when several are live', () => {
    const picked = pickLiveRound(
      [row('older', 'active', '2026-07-23'), row('newer', 'active', '2026-07-24')],
      NOW
    );
    expect(picked?.group_post.id).toBe('newer');
  });

  it('survives malformed rows', () => {
    const bad = { participant_id: 'p', group_post: { id: 'x', status: 'active', date: null } } as LiveRoundRow;
    expect(pickLiveRound([bad], NOW)).toBeNull();
  });
});
