import { describe, it, expect } from 'vitest';
import {
  resolveRoundStatus,
  isRoundLive,
  isActiveParticipant,
  effectiveRoundStatus,
  initialRoundStatus,
  AUTO_END_AFTER_MS,
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

describe('resolveRoundStatus — 6h quiet auto-end', () => {
  const NOW = Date.parse('2026-07-25T18:00:00Z');
  const quiet = NOW - AUTO_END_AFTER_MS - 60_000; // 6h1m ago
  const recent = NOW - AUTO_END_AFTER_MS + 60_000; // 5h59m ago

  it('completes an active round quiet past the window (partial holes)', () => {
    expect(
      resolveRoundStatus({
        status: 'active', holesPlayed: 18,
        participants: [p(true, 9), p(true, 9)],
        lastActivityAt: quiet, now: NOW,
      })
    ).toBe('completed');
  });

  it('leaves an active round alone while activity is recent', () => {
    expect(
      resolveRoundStatus({
        status: 'active', holesPlayed: 18,
        participants: [p(true, 9), p(true, 9)],
        lastActivityAt: recent, now: NOW,
      })
    ).toBeNull();
  });

  it('quiet rule never fires on pending rounds', () => {
    expect(
      resolveRoundStatus({
        status: 'pending', holesPlayed: 18,
        participants: [p(true, 0)],
        lastActivityAt: quiet, now: NOW,
      })
    ).toBeNull();
  });

  it('completed stays terminal even with stale activity data', () => {
    expect(
      resolveRoundStatus({
        status: 'completed', holesPlayed: 18,
        participants: [p(true, 18)],
        lastActivityAt: quiet, now: NOW,
      })
    ).toBeNull();
  });
});

describe('effectiveRoundStatus', () => {
  const NOW = Date.parse('2026-07-25T18:00:00Z');
  const quietIso = new Date(NOW - AUTO_END_AFTER_MS - 60_000).toISOString();
  const recentIso = new Date(NOW - AUTO_END_AFTER_MS + 60_000).toISOString();

  it('renders a quiet active round as completed', () => {
    expect(effectiveRoundStatus({ status: 'active', last_score_activity_at: quietIso }, NOW)).toBe('completed');
  });

  it('keeps a recently-active round active', () => {
    expect(effectiveRoundStatus({ status: 'active', last_score_activity_at: recentIso }, NOW)).toBe('active');
  });

  it('passes through raw status when activity data is missing or garbage', () => {
    expect(effectiveRoundStatus({ status: 'active' }, NOW)).toBe('active');
    expect(effectiveRoundStatus({ status: 'active', last_score_activity_at: 'not-a-date' }, NOW)).toBe('active');
    expect(effectiveRoundStatus({ status: 'completed', last_score_activity_at: quietIso }, NOW)).toBe('completed');
    expect(effectiveRoundStatus({ status: 'pending', last_score_activity_at: quietIso }, NOW)).toBe('pending');
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

  it('is NOT live for pending or completed rounds regardless of date', () => {
    expect(isRoundLive({ status: 'pending', date: '2026-07-23' }, NOW)).toBe(false);
    expect(isRoundLive({ status: 'completed', date: '2026-07-23' }, NOW)).toBe(false);
  });

  it('is NOT live once the round has gone quiet past the auto-end window', () => {
    const quietIso = new Date(NOW - AUTO_END_AFTER_MS - 60_000).toISOString();
    expect(isRoundLive({ status: 'active', date: '2026-07-23', last_score_activity_at: quietIso }, NOW)).toBe(false);
  });

  it('handles missing/garbage data without throwing', () => {
    expect(isRoundLive({ status: 'active', date: null }, NOW)).toBe(false);
    expect(isRoundLive({ status: 'active', date: 'not-a-date' }, NOW)).toBe(false);
    expect(isRoundLive({}, NOW)).toBe(false);
  });
});

describe('abandoned live round (the July 25 case)', () => {
  it('resolves an abandoned round to completed so it can mirror into stats', () => {
    // Real production shape: two players scored one hole each, then stopped.
    // advanceRoundStatus only fires on a score write, so the row sat 'active'
    // for six days and mirrorCompletedRound — which requires 'completed' —
    // never ran, leaving both players' scores out of trends and handicap.
    // The daily round sweep exists to give this rule a reason to run.
    const lastActivity = Date.parse('2026-07-25T19:30:00Z');
    const now = Date.parse('2026-07-31T18:00:00Z');
    expect(
      resolveRoundStatus({
        status: 'active',
        holesPlayed: 18,
        participants: [
          { confirmed: true, holesCompleted: 1 },
          { confirmed: true, holesCompleted: 1 },
        ],
        lastActivityAt: lastActivity,
        now,
      })
    ).toBe('completed');
  });

  it('leaves a genuinely live round alone', () => {
    const now = Date.parse('2026-07-31T18:00:00Z');
    expect(
      resolveRoundStatus({
        status: 'active',
        holesPlayed: 18,
        participants: [{ confirmed: true, holesCompleted: 4 }],
        lastActivityAt: now - 10 * 60 * 1000, // 10 minutes ago
        now,
      })
    ).toBeNull();
  });
});
