import { describe, it, expect } from 'vitest';
import {
  resolveRoundStatus,
  isRoundLive,
  isActiveParticipant,
  initialRoundStatus,
  shouldShowStaleNotice,
  abandonedRoundAction,
  countLiveVisibleRounds,
  ABANDON_AFTER_MS,
} from '../round-status';

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

describe('resolveRoundStatus — no quiet rule (Drafts round, Oct 2026)', () => {
  const NOW = Date.parse('2026-07-25T18:00:00Z');
  it('an active round nobody has scored in for a week is NOT finished by a score write — the player who comes back keeps playing', () => {
    expect(
      resolveRoundStatus({
        status: 'active', holesPlayed: 18,
        participants: [p(true, 9), p(true, 9)],
        lastActivityAt: NOW - 8 * 24 * 60 * 60 * 1000, now: NOW,
      })
    ).toBeNull();
  });
  it('completion still comes from the cards: everyone who scored finished every hole', () => {
    expect(
      resolveRoundStatus({ status: 'active', holesPlayed: 9, participants: [p(true, 9)], lastActivityAt: NOW - 8 * 24 * 60 * 60 * 1000, now: NOW })
    ).toBe('completed');
  });
});

describe('initialRoundStatus', () => {
  it("maps only an explicit boolean true to 'completed'", () => {
    expect(initialRoundStatus(true)).toBe('completed');
    expect(initialRoundStatus(false)).toBe('pending');
    expect(initialRoundStatus(undefined)).toBe('pending');
    expect(initialRoundStatus('true')).toBe('pending');
    expect(initialRoundStatus(1)).toBe('pending');
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

  it('IS live for a pending round in its window — a started, zero-score round is an open session (dummy-proofing round)', () => {
    // The bug: requiring 'active' here meant a round with no scores had no
    // LIVE presence, no resume banner, and leaked into the feed as an empty
    // post the moment it was created.
    expect(isRoundLive({ status: 'pending', date: '2026-07-23' }, NOW)).toBe(true);
    expect(isRoundLive({ status: 'pending', date: '2026-07-22' }, NOW)).toBe(true);
  });

  it('is NOT live for a pending round past its window (the sweep cancels those)', () => {
    expect(isRoundLive({ status: 'pending', date: '2026-07-18' }, NOW)).toBe(false);
  });

  it('is NOT live for completed or cancelled rounds regardless of date', () => {
    expect(isRoundLive({ status: 'completed', date: '2026-07-23' }, NOW)).toBe(false);
    expect(isRoundLive({ status: 'cancelled', date: '2026-07-23' }, NOW)).toBe(false);
  });

  it('a quiet active round dated today is still LIVE — no quiet rule at read time (Drafts round)', () => {
    const quietIso = new Date(NOW - 7 * 60 * 60 * 1000).toISOString();
    expect(isRoundLive({ status: 'active', date: '2026-07-23', last_score_activity_at: quietIso }, NOW)).toBe(true);
  });

  it('handles missing/garbage data without throwing', () => {
    expect(isRoundLive({ status: 'active', date: null }, NOW)).toBe(false);
    expect(isRoundLive({ status: 'active', date: 'not-a-date' }, NOW)).toBe(false);
    expect(isRoundLive({}, NOW)).toBe(false);
  });
});

describe('abandonedRoundAction — the daily sweep\'s 7-day rule (Tom, Oct 6 2026)', () => {
  const NOW = Date.parse('2026-10-13T18:00:00Z');
  const week = 7 * 24 * 60 * 60 * 1000;
  const old = new Date(NOW - week - 60_000).toISOString();
  const recent = new Date(NOW - week + 60_000).toISOString();

  it('an ACTIVE round untouched for 7 days is FINISHED as played (the July 25 case — its scores become the record)', () => {
    expect(abandonedRoundAction({ status: 'active', createdAt: old, lastActivityAt: old }, NOW)).toBe('finish');
  });
  it('a PENDING round (nobody scored) untouched for 7 days is DISCARDED — nothing was recorded', () => {
    expect(abandonedRoundAction({ status: 'pending', createdAt: old, lastActivityAt: null }, NOW)).toBe('discard');
  });
  it('the clock is the last score for an active round, the creation for a pending one', () => {
    expect(abandonedRoundAction({ status: 'active', createdAt: old, lastActivityAt: recent }, NOW)).toBeNull();
    expect(abandonedRoundAction({ status: 'pending', createdAt: recent }, NOW)).toBeNull();
    expect(ABANDON_AFTER_MS).toBe(week);
  });
  it('an active round with no activity on record waits (never guesses)', () => {
    expect(abandonedRoundAction({ status: 'active', createdAt: old, lastActivityAt: null }, NOW)).toBeNull();
  });
  it('completed, cancelled, an event\'s round and garbage dates never fire', () => {
    expect(abandonedRoundAction({ status: 'completed', createdAt: old, lastActivityAt: old }, NOW)).toBeNull();
    expect(abandonedRoundAction({ status: 'cancelled', createdAt: old }, NOW)).toBeNull();
    expect(abandonedRoundAction({ status: 'active', createdAt: old, lastActivityAt: old, sportEventRoundId: 'r1' }, NOW)).toBeNull();
    expect(abandonedRoundAction({ status: 'active', createdAt: old, lastActivityAt: 'not-a-date' }, NOW)).toBeNull();
    expect(abandonedRoundAction({ status: 'pending', createdAt: null }, NOW)).toBeNull();
  });
});

describe('shouldShowStaleNotice', () => {
  it('shows only while the round is live', () => {
    expect(shouldShowStaleNotice({ stale: true, live: true })).toBe(true);
  });

  it('NEVER shows on a finished round, however stale the flag', () => {
    // The bug this fixes: a refresh that failed during play latched the flag on,
    // and refreshing stops once a round is no longer live — so a FINAL round
    // contradicted itself by claiming its scores might still be out of date.
    expect(shouldShowStaleNotice({ stale: true, live: false })).toBe(false);
  });

  it('does not show on a live round that is refreshing fine', () => {
    expect(shouldShowStaleNotice({ stale: false, live: true })).toBe(false);
    expect(shouldShowStaleNotice({ stale: false, live: false })).toBe(false);
  });
});

describe('countLiveVisibleRounds', () => {
  const NOW = Date.parse('2026-07-23T18:00:00Z');
  const LIVE = '2026-07-23'; // within the ±48h window
  const STALE = '2026-07-18'; // outside the window → not live

  it('counts public live rounds', () => {
    const rows = [
      { id: 'a', visibility: 'public', status: 'active', date: LIVE },
      { id: 'b', visibility: 'public', status: 'pending', date: LIVE },
    ];
    expect(countLiveVisibleRounds(rows, new Set(), NOW)).toBe(2);
  });

  it('counts a private round only when the viewer is on the roster', () => {
    const rows = [
      { id: 'mine', visibility: 'private', status: 'active', date: LIVE },
      { id: 'theirs', visibility: 'private', status: 'active', date: LIVE },
    ];
    expect(countLiveVisibleRounds(rows, new Set(['mine']), NOW)).toBe(1);
  });

  it('excludes rounds outside the live window even when public', () => {
    const rows = [{ id: 'a', visibility: 'public', status: 'active', date: STALE }];
    expect(countLiveVisibleRounds(rows, new Set(), NOW)).toBe(0);
  });

  it('excludes completed/cancelled rounds', () => {
    const rows = [
      { id: 'a', visibility: 'public', status: 'completed', date: LIVE },
      { id: 'b', visibility: 'public', status: 'cancelled', date: LIVE },
    ];
    expect(countLiveVisibleRounds(rows, new Set(), NOW)).toBe(0);
  });

  it('dedupes by id so a round in both scopes counts once', () => {
    const rows = [
      { id: 'dup', visibility: 'public', status: 'active', date: LIVE },
      { id: 'dup', visibility: 'public', status: 'active', date: LIVE },
    ];
    expect(countLiveVisibleRounds(rows, new Set(['dup']), NOW)).toBe(1);
  });

  it('returns 0 for an empty set', () => {
    expect(countLiveVisibleRounds([], new Set(), NOW)).toBe(0);
  });
});
