import { describe, expect, it } from 'vitest';
import { roundDurationMs, roundSuffix, sportEventHref, sportEventRoundToItem, type SportEventItemInput } from '../sport-event-overlay';

const base: SportEventItemInput = {
  viewerId: 'me',
  event: { id: 'e1', name: 'Spring Open' },
  round: { id: 'r1', sequence: 1, scheduled_on: '2030-06-01', status: 'scheduled', holes: 18, course_name: 'QA Links', name: null },
  roundCount: 1,
  teeTime: null,
  role: 'participant',
  participantStatus: 'accepted',
};

describe('sportEventRoundToItem', () => {
  it('a date-only round is an all-day item on its UTC day with an exclusive end (the 057 convention)', () => {
    const item = sportEventRoundToItem(base)!;
    expect(item.id).toBe('sport_event:r1');
    expect(item.kind).toBe('sport_event');
    expect(item.category).toBe('tournament');
    expect(item.all_day).toBe(true);
    expect(item.starts_at).toBe('2030-06-01T00:00:00.000Z');
    expect(item.ends_at).toBe('2030-06-02T00:00:00.000Z');
    expect(item.timezone).toBe('UTC');
    expect(item.title).toBe('Spring Open');
    expect(item.location).toBe('QA Links');
    expect(item.my_status).toBe('accepted');
    expect(item.is_organizer).toBe(false);
    expect(item.sport_event).toEqual({ event_id: 'e1', round_id: 'r1', sequence: 1, round_count: 1, round_status: 'scheduled', tab: 'schedule' });
  });
  it('the viewer\'s tee time makes it timed: 4h30 for 18, 2h15 for nine', () => {
    const t18 = sportEventRoundToItem({ ...base, teeTime: '2030-06-01T14:10:00.000Z' })!;
    expect(t18.all_day).toBe(false);
    expect(t18.starts_at).toBe('2030-06-01T14:10:00.000Z');
    expect(t18.ends_at).toBe('2030-06-01T18:40:00.000Z');
    const t9 = sportEventRoundToItem({ ...base, teeTime: '2030-06-01T14:10:00.000Z', round: { ...base.round, holes: 9 } })!;
    expect(t9.ends_at).toBe('2030-06-01T16:25:00.000Z');
    expect(roundDurationMs(18)).toBe(4.5 * 3_600_000);
    expect(roundDurationMs(9)).toBe(2.25 * 3_600_000);
  });
  it('an invite keeps the dashed needs-reply styling; an organizer is one; a tournament names the round', () => {
    expect(sportEventRoundToItem({ ...base, participantStatus: 'invited' })!.my_status).toBe('invited');
    expect(sportEventRoundToItem({ ...base, participantStatus: 'waitlisted' })!.my_status).toBe('accepted');
    expect(sportEventRoundToItem({ ...base, role: 'co_organizer' })!.is_organizer).toBe(true);
    const r2 = sportEventRoundToItem({ ...base, roundCount: 3, round: { ...base.round, id: 'r2', sequence: 2, name: 'Saturday', status: 'live' } })!;
    expect(r2.title).toBe('Spring Open · Round 2 of 3');
    expect(r2.description).toBe('Saturday');
    expect(r2.sport_event.tab).toBe('leaderboard');
    expect(roundSuffix(1, 1)).toBe('');
  });
  it('refuses a malformed date rather than rendering at epoch', () => {
    expect(sportEventRoundToItem({ ...base, round: { ...base.round, scheduled_on: '2030-6-1' } })).toBeNull();
    expect(sportEventRoundToItem({ ...base, round: { ...base.round, scheduled_on: '' } })).toBeNull();
  });
  it('the href is the event\'s page on the round — the leaderboard while live', () => {
    expect(sportEventHref({ event_id: 'e1', round_id: 'r1', sequence: 1, round_count: 1, round_status: 'scheduled', tab: 'schedule' })).toBe('/events/e1?tab=schedule&round=r1');
    expect(sportEventHref({ event_id: 'e1', round_id: 'r2', sequence: 2, round_count: 2, round_status: 'live', tab: 'leaderboard' })).toBe('/events/e1?tab=leaderboard&round=r2');
  });
  it('serialises without the viewer\'s or anyone\'s profile id beyond organizer_id (the viewer\'s own)', () => {
    const json = JSON.stringify(sportEventRoundToItem(base));
    expect(json).not.toContain('participant');
    expect(json).toContain('"organizer_id":"me"');
  });
});

describe('the round\'s own start (leftovers PR 8)', () => {
  it('a start without a tee time makes a timed item in the ROUND\'s zone; a tee time wins; no start stays all-day', () => {
    const base = { viewerId: 'v', event: { id: 'e1', name: 'Cup' }, round: { id: 'r1', sequence: 1, scheduled_on: '2030-06-01', status: 'scheduled' as const, holes: 18, course_name: 'Rink', starts_at: '2030-06-02T05:00:00.000Z', timezone: 'Pacific/Honolulu' }, roundCount: 1, teeTime: null, role: null, participantStatus: 'accepted' as const };
    const item = sportEventRoundToItem(base)!;
    expect(item.all_day).toBe(false);
    expect(item.starts_at).toBe('2030-06-02T05:00:00.000Z');
    expect(item.timezone).toBe('Pacific/Honolulu');
    const tee = sportEventRoundToItem({ ...base, teeTime: '2030-06-01T14:10:00.000Z' })!;
    expect(tee.starts_at).toBe('2030-06-01T14:10:00.000Z');
    expect(tee.timezone).toBe('UTC');
    const none = sportEventRoundToItem({ ...base, round: { ...base.round, starts_at: null } })!;
    expect(none.all_day).toBe(true);
  });
});
