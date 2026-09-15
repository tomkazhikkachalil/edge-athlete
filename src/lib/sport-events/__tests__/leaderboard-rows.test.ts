import { describe, expect, it } from 'vitest';
import { toLeaderboardPlayers } from '../leaderboard-rows';
import { bellCopy } from '../notify';

describe('toLeaderboardPlayers', () => {
  it('the field is the accepted, playing participants; a declined round row and a missing card both mean no scores; names are masked', () => {
    const profiles = new Map([
      ['a', { id: 'a', first_name: 'Ann', last_name: 'Lee', full_name: 'Ann Lee', visibility: 'public', email: 'a@x.com', supervision_state: null, handle: 'ann' }],
      ['b', { id: 'b', first_name: 'Bo', last_name: 'Kim', full_name: 'Bo Kim', visibility: 'private', email: 'b@x.com', supervision_state: null, handle: 'bo' }],
    ]);
    const out = toLeaderboardPlayers(
      [{ id: 'pa', profile_id: 'a', handicap_index: 10 }, { id: 'pb', profile_id: 'b', handicap_index: null }, { id: 'pc', profile_id: 'c', handicap_index: null }],
      [
        { profile_id: 'a', status: 'confirmed', card: { status: 'submitted', hole_scores: [{ hole_number: 1, strokes: 4 }] } },
        { profile_id: 'b', status: 'declined', card: { status: 'final', hole_scores: [{ hole_number: 1, strokes: 9 }] } },
      ],
      profiles,
    );
    expect(out).toEqual([
      { participantId: 'pa', profileId: 'a', name: 'Ann Lee', handle: 'ann', handicapIndex: 10, flight: null, holeScores: [{ hole_number: 1, strokes: 4 }], cardStatus: 'submitted' },
      { participantId: 'pb', profileId: 'b', name: 'Bo K.', handle: null, handicapIndex: null, flight: null, holeScores: [], cardStatus: 'in_progress' },
      { participantId: 'pc', profileId: 'c', name: 'Athlete', handle: null, handicapIndex: null, flight: null, holeScores: [], cardStatus: 'in_progress' },
    ]);
    expect(JSON.stringify(out)).not.toContain('@x.com');
  });
  it('the results bell lands on the leaderboard tab', () => {
    expect(bellCopy('results', { eventId: 'e1', eventName: 'Open', actorName: '' })).toEqual({ type: 'sport_event_results', title: 'Results are in for Open', message: 'See the final leaderboard.', action_url: '/events/e1?tab=leaderboard' });
  });
});
