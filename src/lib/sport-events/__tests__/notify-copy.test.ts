import { describe, expect, it } from 'vitest';
import { bellCopy, eventPath } from '../notify';

describe('the sport_event_* bell copy', () => {
  const ctx = { eventId: 'e1', eventName: 'Spring Open', actorName: 'Alex Rivera' };
  it('every line names the event and lands on the right tab', () => {
    expect(bellCopy('invite', ctx)).toEqual({ type: 'sport_event_invite', title: 'Alex Rivera invited you to Spring Open', message: 'Accept to play, or decline.', action_url: '/events/e1?tab=players' });
    expect(bellCopy('request', ctx)).toMatchObject({ type: 'sport_event_request', title: 'Alex Rivera asked to join Spring Open', action_url: '/events/e1?tab=players' });
    expect(bellCopy('approved', ctx)).toMatchObject({ type: 'sport_event_request_decision', title: "You're in: Spring Open", action_url: '/events/e1' });
    expect(bellCopy('rejected', ctx)).toMatchObject({ type: 'sport_event_request_decision', title: 'Not this time: Spring Open' });
    expect(bellCopy('promoted', ctx)).toMatchObject({ type: 'sport_event_request_decision', title: 'A spot opened up: Spring Open' });
    expect(eventPath('e1', 'leaderboard')).toBe('/events/e1?tab=leaderboard');
  });
});

describe('phase 4 — the live bell', () => {
  it('names the event (and the round on a tournament) and lands on the live board, or the matches on match play', () => {
    expect(bellCopy('live', { eventId: 'e1', eventName: 'Cup', actorName: '', roundId: 'r1' })).toEqual({ type: 'sport_event_live', title: 'Live now: Cup', message: 'Follow the leaderboard as the scores come in.', action_url: '/events/e1?tab=leaderboard&round=r1' });
    expect(bellCopy('live', { eventId: 'e1', eventName: 'Cup', actorName: '', roundId: 'r2', roundLabel: 'Round 2' }).title).toBe('Live now: Cup · Round 2');
    expect(bellCopy('live', { eventId: 'e1', eventName: 'Cup', actorName: '', roundId: 'r1', matchPlay: true }).action_url).toBe('/events/e1?tab=matches&round=r1');
  });
});

describe('phase 3 — the results bell on a match event', () => {
  it('lands on the Matches tab, the leaderboard otherwise', () => {
    expect(eventPath('e1', 'matches')).toBe('/events/e1?tab=matches');
    expect(bellCopy('results', { eventId: 'e1', eventName: 'Cup', actorName: '', matchPlay: true })).toMatchObject({ type: 'sport_event_results', action_url: '/events/e1?tab=matches' });
    expect(bellCopy('results', { eventId: 'e1', eventName: 'Cup', actorName: '' }).action_url).toBe('/events/e1?tab=leaderboard');
  });
});

describe('phase 4: the live bell on a team shape', () => {
  it('opens the live stat screen; golf keeps the board / the matches', () => {
    expect(bellCopy('live', { eventId: 'e1', eventName: 'Friday skate', actorName: '', roundId: 'r1', teamShape: true })).toMatchObject({ type: 'sport_event_live', action_url: '/events/e1/live?round=r1', message: expect.stringContaining('score') });
    expect(bellCopy('live', { eventId: 'e1', eventName: 'Open', actorName: '', roundId: 'r1' })).toMatchObject({ action_url: '/events/e1?tab=leaderboard&round=r1' });
  });
});
