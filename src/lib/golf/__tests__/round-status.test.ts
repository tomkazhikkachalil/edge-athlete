import { describe, it, expect } from 'vitest';
import { resolveRoundStatus, isRoundLive, isActiveParticipant } from '../round-status';

const p = (confirmed: boolean, holesCompleted: number) => ({ confirmed, holesCompleted });

describe('resolveRoundStatus', () => {
  it('leaves a pending round untouched when nobody has scored', () => {
    expect(
      resolveRoundStatus({ status: 'pending', holesPlayed: 18, participants: [p(true, 0), p(true, 0)] })
    ).toBeNull();
  });

  it('flips pending → active on the first score activity (live entry, hole 1)', () => {
    expect(
      resolveRoundStatus({ status: 'pending', holesPlayed: 18, participants: [p(true, 1), p(true, 0)] })
    ).toBe('active');
  });

  it('keeps an active round active mid-round (no redundant update)', () => {
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 18, participants: [p(true, 9), p(true, 7)] })
    ).toBeNull();
  });

  it('completes when every participant who scored has finished all holes', () => {
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 18, participants: [p(true, 18), p(true, 18)] })
    ).toBe('completed');
  });

  it('completes a 9-hole round at 9 holes', () => {
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 9, participants: [p(true, 9)] })
    ).toBe('completed');
  });

  it('sends a full after-the-fact batch straight to completed (never lingers as LIVE)', () => {
    // Creator posts a finished round with only their own scorecard filled in.
    expect(
      resolveRoundStatus({ status: 'pending', holesPlayed: 18, participants: [p(true, 18), p(true, 0), p(true, 0)] })
    ).toBe('completed');
  });

  it('waits for a second scorer who is mid-round', () => {
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 18, participants: [p(true, 18), p(true, 12)] })
    ).toBeNull();
  });

  it('ignores unconfirmed participants entirely', () => {
    // A pending invitee with no scores can't hold the round open…
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 18, participants: [p(true, 18), p(false, 0)] })
    ).toBe('completed');
  });

  it('never resurrects a completed or cancelled round', () => {
    expect(
      resolveRoundStatus({ status: 'completed', holesPlayed: 18, participants: [p(true, 3)] })
    ).toBeNull();
    expect(
      resolveRoundStatus({ status: 'cancelled', holesPlayed: 18, participants: [p(true, 18)] })
    ).toBeNull();
  });

  it('does nothing when holesPlayed is missing/zero (malformed scorecard)', () => {
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 0, participants: [p(true, 18)] })
    ).toBeNull();
  });
});

describe('isActiveParticipant', () => {
  it('counts everyone except an explicit decline (auto-confirm model)', () => {
    expect(isActiveParticipant('confirmed')).toBe(true);
    expect(isActiveParticipant('pending')).toBe(true); // legacy pre-033 rows
    expect(isActiveParticipant('maybe')).toBe(true);
    expect(isActiveParticipant(null)).toBe(true);
    expect(isActiveParticipant(undefined)).toBe(true);
    expect(isActiveParticipant('declined')).toBe(false);
  });
});

describe('isRoundLive', () => {
  const NOW = Date.parse('2026-07-23T18:00:00Z');

  it('is live for an active round dated today', () => {
    expect(isRoundLive({ status: 'active', date: '2026-07-23' }, NOW)).toBe(true);
  });

  it('is live for an active round dated yesterday (long round / timezone slop)', () => {
    expect(isRoundLive({ status: 'active', date: '2026-07-22' }, NOW)).toBe(true);
  });

  it('is NOT live for an active round abandoned days ago', () => {
    expect(isRoundLive({ status: 'active', date: '2026-07-18' }, NOW)).toBe(false);
  });

  it('is NOT live for pending or completed rounds regardless of date', () => {
    expect(isRoundLive({ status: 'pending', date: '2026-07-23' }, NOW)).toBe(false);
    expect(isRoundLive({ status: 'completed', date: '2026-07-23' }, NOW)).toBe(false);
  });

  it('handles missing/garbage data without throwing', () => {
    expect(isRoundLive({ status: 'active', date: null }, NOW)).toBe(false);
    expect(isRoundLive({ status: 'active', date: 'not-a-date' }, NOW)).toBe(false);
    expect(isRoundLive({}, NOW)).toBe(false);
  });
});
