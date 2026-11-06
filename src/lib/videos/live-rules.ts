/**
 * Live (Videos program Phase 4a, Nov 5 2026) — the pure rules. ZERO imports.
 *
 * A YouTube broadcast is a video with the same id before, during and after
 * the stream, so a linked broadcast is an ordinary `videos` row that knows
 * its state. This file decides: what YouTube's answer means, when a state is
 * stale enough to ask again (reader-driven — the quota is spent by viewers,
 * never by a clock), the zero of a marker made during the stream, and what a
 * card or the page says. Everything here is pinned by live-rules.test.ts.
 */

export const LIVE_STATUSES = ['none', 'upcoming', 'live', 'ended'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

export function isLiveStatus(v: unknown): v is LiveStatus {
  return typeof v === 'string' && (LIVE_STATUSES as readonly string[]).includes(v);
}

/** What `videos.list` (part=snippet,liveStreamingDetails) says about one id. */
export interface LiveApiFacts {
  liveBroadcastContent: string | null;
  scheduledStartTime: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
}

export interface LiveState {
  live_status: LiveStatus;
  scheduled_start_at: string | null;
  live_started_at: string | null;
  live_ended_at: string | null;
}

function iso(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * YouTube's words → ours. `live` and `upcoming` are YouTube's own; a video
 * that once streamed (an actual start or end) and is no longer live is
 * `ended` — the archive; anything else is a plain video (`none`).
 */
export function liveStateFromApi(f: LiveApiFacts): LiveState {
  const scheduled = iso(f.scheduledStartTime);
  const started = iso(f.actualStartTime);
  const ended = iso(f.actualEndTime);
  let status: LiveStatus = 'none';
  if (f.liveBroadcastContent === 'live') status = 'live';
  else if (f.liveBroadcastContent === 'upcoming') status = 'upcoming';
  else if (started || ended) status = 'ended';
  return { live_status: status, scheduled_start_at: scheduled, live_started_at: started, live_ended_at: ended };
}

// ── When to ask again ───────────────────────────────────────────────────────
export const LIVE_TTL_MS = { live: 45_000, upcomingSoon: 60_000, upcomingFar: 10 * 60_000 } as const;
/** "Soon" = within the hour before the scheduled start (and any upcoming broadcast with no time). */
export const LIVE_SOON_MS = 60 * 60_000;
/** After a quotaExceeded answer nobody asks for this long. */
export const QUOTA_BACKOFF_MS = 10 * 60_000;

export interface LiveClock {
  live_status: LiveStatus;
  scheduled_start_at: string | null;
  live_checked_at: string | null;
}

/** How long a state is trusted; null = never asked again (a plain video, an archive). */
export function liveRefreshTtlMs(status: LiveStatus, scheduledStartAt: string | null, now: number): number | null {
  if (status === 'live') return LIVE_TTL_MS.live;
  if (status !== 'upcoming') return null;
  const at = scheduledStartAt ? Date.parse(scheduledStartAt) : NaN;
  if (Number.isNaN(at) || at - now <= LIVE_SOON_MS) return LIVE_TTL_MS.upcomingSoon;
  return LIVE_TTL_MS.upcomingFar;
}

/** Due = there is a TTL and it has passed (or the state was never read). */
export function liveRefreshDue(row: LiveClock, now: number): boolean {
  const ttl = liveRefreshTtlMs(row.live_status, row.scheduled_start_at, now);
  if (ttl === null) return false;
  if (!row.live_checked_at) return true;
  const checked = Date.parse(row.live_checked_at);
  return Number.isNaN(checked) || now - checked >= ttl;
}

/**
 * What a read's duration does to the row: nothing while upcoming or live
 * (YouTube says PT0S until the stream ends); fills a duration still null; and
 * REPLACES whatever was there the moment a broadcast becomes the archive
 * (its real length). Null = leave duration_ms alone.
 */
export function durationToRecord(row: { duration_ms: number | null; live_status: LiveStatus }, state: LiveState, durationMs: number | null): number | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (state.live_status === 'live' || state.live_status === 'upcoming') return null;
  if (row.duration_ms === null) return Math.round(durationMs);
  if (state.live_status === 'ended' && row.live_status !== 'ended') return Math.round(durationMs);
  return null;
}

// ── The marker made live ────────────────────────────────────────────────────
/** The offset of "now" into the stream, from YouTube's actual start; null when the stream has no start. */
export function markNowOffsetMs(liveStartedAt: string | null, now: number): number | null {
  if (!liveStartedAt) return null;
  const start = Date.parse(liveStartedAt);
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.round(now - start));
}

// ── What the surfaces say ───────────────────────────────────────────────────
export type LiveBadge = { kind: 'live' } | { kind: 'upcoming'; at: string | null } | { kind: 'ended'; at: string | null } | null;

export function liveBadgeFor(v: { live_status: LiveStatus; scheduled_start_at: string | null; live_started_at: string | null }): LiveBadge {
  if (v.live_status === 'live') return { kind: 'live' };
  if (v.live_status === 'upcoming') return { kind: 'upcoming', at: v.scheduled_start_at };
  if (v.live_status === 'ended') return { kind: 'ended', at: v.live_started_at };
  return null;
}

/** The page's own re-read while a broadcast is live or about to be; null = no polling. */
export function liveRefetchMs(v: { live_status: LiveStatus; scheduled_start_at: string | null }, now: number = Date.now()): number | null {
  if (v.live_status === 'live') return 60_000;
  if (v.live_status !== 'upcoming') return null;
  const at = v.scheduled_start_at ? Date.parse(v.scheduled_start_at) : NaN;
  return Number.isNaN(at) || at - now <= LIVE_SOON_MS ? 60_000 : null;
}

/** "today at 2:00 PM" / "tomorrow at …" / "Sat, Nov 8 at …" in the viewer's locale. */
export function formatLiveWhen(isoAt: string, now: Date = new Date()): string {
  const d = new Date(isoAt);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}
