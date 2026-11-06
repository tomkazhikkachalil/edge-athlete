import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatLiveWhen,
  isLiveStatus,
  LIVE_SOON_MS,
  LIVE_TTL_MS,
  liveBadgeFor,
  liveRefetchMs,
  liveRefreshDue,
  liveRefreshTtlMs,
  liveStateFromApi,
  durationToRecord,
  markNowOffsetMs,
  QUOTA_BACKOFF_MS,
} from '../live-rules';

const T0 = Date.parse('2026-11-08T19:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('live-rules — zero imports', () => {
  it('imports nothing', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/videos/live-rules.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});

describe("YouTube's words → ours", () => {
  it('live and upcoming are YouTube\'s own; a stream that started or ended and is no longer live is the archive; anything else is a plain video', () => {
    expect(liveStateFromApi({ liveBroadcastContent: 'live', scheduledStartTime: iso(T0), actualStartTime: iso(T0 + 1000), actualEndTime: null })).toEqual({ live_status: 'live', scheduled_start_at: iso(T0), live_started_at: iso(T0 + 1000), live_ended_at: null });
    expect(liveStateFromApi({ liveBroadcastContent: 'upcoming', scheduledStartTime: iso(T0), actualStartTime: null, actualEndTime: null }).live_status).toBe('upcoming');
    expect(liveStateFromApi({ liveBroadcastContent: 'none', scheduledStartTime: iso(T0), actualStartTime: iso(T0), actualEndTime: iso(T0 + 3_600_000) }).live_status).toBe('ended');
    expect(liveStateFromApi({ liveBroadcastContent: 'none', scheduledStartTime: null, actualStartTime: null, actualEndTime: null })).toEqual({ live_status: 'none', scheduled_start_at: null, live_started_at: null, live_ended_at: null });
    expect(liveStateFromApi({ liveBroadcastContent: null, scheduledStartTime: null, actualStartTime: null, actualEndTime: null }).live_status).toBe('none');
  });
  it('a time that does not parse is null, never a crash', () => {
    expect(liveStateFromApi({ liveBroadcastContent: 'upcoming', scheduledStartTime: 'soon', actualStartTime: null, actualEndTime: null }).scheduled_start_at).toBeNull();
  });
  it('the status vocabulary', () => {
    expect(isLiveStatus('live')).toBe(true);
    expect(isLiveStatus('ready')).toBe(false);
  });
});

describe('when to ask again (reader-driven, never a clock)', () => {
  it('live every 45 s; upcoming within the hour every minute, further out every ten; a plain video or an archive never', () => {
    expect(liveRefreshTtlMs('live', null, T0)).toBe(LIVE_TTL_MS.live);
    expect(liveRefreshTtlMs('upcoming', iso(T0 + LIVE_SOON_MS - 1), T0)).toBe(LIVE_TTL_MS.upcomingSoon);
    expect(liveRefreshTtlMs('upcoming', null, T0)).toBe(LIVE_TTL_MS.upcomingSoon);
    expect(liveRefreshTtlMs('upcoming', iso(T0 + LIVE_SOON_MS + 1), T0)).toBe(LIVE_TTL_MS.upcomingFar);
    expect(liveRefreshTtlMs('none', null, T0)).toBeNull();
    expect(liveRefreshTtlMs('ended', null, T0)).toBeNull();
  });
  it('due = the TTL has passed, or the state was never read; a parked row (a future check) is not due', () => {
    expect(liveRefreshDue({ live_status: 'live', scheduled_start_at: null, live_checked_at: null }, T0)).toBe(true);
    expect(liveRefreshDue({ live_status: 'live', scheduled_start_at: null, live_checked_at: iso(T0 - 44_000) }, T0)).toBe(false);
    expect(liveRefreshDue({ live_status: 'live', scheduled_start_at: null, live_checked_at: iso(T0 - 45_000) }, T0)).toBe(true);
    expect(liveRefreshDue({ live_status: 'live', scheduled_start_at: null, live_checked_at: iso(T0 + QUOTA_BACKOFF_MS) }, T0)).toBe(false);
    expect(liveRefreshDue({ live_status: 'ended', scheduled_start_at: null, live_checked_at: null }, T0)).toBe(false);
  });
  it('the page polls only while live or about to be', () => {
    expect(liveRefetchMs({ live_status: 'live', scheduled_start_at: null }, T0)).toBe(60_000);
    expect(liveRefetchMs({ live_status: 'upcoming', scheduled_start_at: iso(T0 + 600_000) }, T0)).toBe(60_000);
    expect(liveRefetchMs({ live_status: 'upcoming', scheduled_start_at: iso(T0 + 2 * LIVE_SOON_MS) }, T0)).toBeNull();
    expect(liveRefetchMs({ live_status: 'ended', scheduled_start_at: null }, T0)).toBeNull();
  });
});

describe('the duration a read carries', () => {
  const state = (live_status: 'none' | 'upcoming' | 'live' | 'ended') => ({ live_status, scheduled_start_at: null, live_started_at: null, live_ended_at: null });
  it('nothing while upcoming or live (YouTube says PT0S), a null duration is filled, and the archive replaces the placeholder once', () => {
    expect(durationToRecord({ duration_ms: null, live_status: 'none' }, state('upcoming'), 90_000)).toBeNull();
    expect(durationToRecord({ duration_ms: null, live_status: 'upcoming' }, state('live'), 90_000)).toBeNull();
    expect(durationToRecord({ duration_ms: null, live_status: 'none' }, state('none'), 90_000)).toBe(90_000);
    expect(durationToRecord({ duration_ms: 90_000, live_status: 'live' }, state('ended'), 10_680_000)).toBe(10_680_000);
    expect(durationToRecord({ duration_ms: 10_680_000, live_status: 'ended' }, state('ended'), 10_680_000)).toBeNull();
    expect(durationToRecord({ duration_ms: 5, live_status: 'none' }, state('none'), 90_000)).toBeNull();
    expect(durationToRecord({ duration_ms: null, live_status: 'none' }, state('none'), 0)).toBeNull();
  });
});

describe('the marker made live', () => {
  it('"Now" is the offset from YouTube\'s actual start, never negative, null without a start', () => {
    expect(markNowOffsetMs(iso(T0), T0 + 90_500)).toBe(90_500);
    expect(markNowOffsetMs(iso(T0), T0 - 5)).toBe(0);
    expect(markNowOffsetMs(null, T0)).toBeNull();
    expect(markNowOffsetMs('later', T0)).toBeNull();
  });
});

describe('what the surfaces say', () => {
  it('the badge follows the row: live → the pill; upcoming → the scheduled time; ended → the recording; a plain video → nothing', () => {
    expect(liveBadgeFor({ live_status: 'live', scheduled_start_at: null, live_started_at: iso(T0) })).toEqual({ kind: 'live' });
    expect(liveBadgeFor({ live_status: 'upcoming', scheduled_start_at: iso(T0), live_started_at: null })).toEqual({ kind: 'upcoming', at: iso(T0) });
    expect(liveBadgeFor({ live_status: 'ended', scheduled_start_at: null, live_started_at: iso(T0) })).toEqual({ kind: 'ended', at: iso(T0) });
    expect(liveBadgeFor({ live_status: 'none', scheduled_start_at: null, live_started_at: null })).toBeNull();
  });
  it('the time reads today / tomorrow / a day, never a raw ISO string, and an unparseable time is empty', () => {
    const now = new Date(T0);
    expect(formatLiveWhen(iso(T0 + 3_600_000), now)).toMatch(/^today at /);
    expect(formatLiveWhen(iso(T0 + 24 * 3_600_000), now)).toMatch(/^tomorrow at /);
    expect(formatLiveWhen(iso(T0 + 3 * 24 * 3_600_000), now)).toMatch(/ at /);
    expect(formatLiveWhen(iso(T0 + 3 * 24 * 3_600_000), now)).not.toContain('T');
    expect(formatLiveWhen('never', now)).toBe('');
  });
});
