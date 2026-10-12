// ── The workout clock's rules (workout screen PR 2, Oct 12 2026) — pure ─────
// Tom: Start/Pause beside the timer; pausing stops the clock without ending
// the workout; "Don't time this workout" saves no duration. The facts live on
// the session (260: `paused_seconds`, `paused_at`, `timed`) — a pause is a
// SERVER fact, so a reload, another device, the resume pill and the 7-day
// sweep all read the same clock — and every number here is DERIVED from
// timestamps, never counted (the recorder's elapsedS rule).
//
// The client's clock stamps a pause (`at`): the entries PUT's stale guard
// compares the client's savedAt to last_activity_at, so a server `now()` on
// the pause would make a lagging phone's next saves silently stale.

/** How far ahead of the server a client stamp may run. */
export const AT_SLACK_MS = 5 * 60 * 1000;

export interface WorkoutClockFacts {
  started_at: string;
  paused_seconds?: number | null;
  paused_at?: string | null;
  ended_at?: string | null;
  timed?: boolean | null;
}

/** Timed unless the session says otherwise (rows before 260 have no column). */
export function isTimed(s: { timed?: boolean | null }): boolean {
  return s.timed !== false;
}

/** Seconds on the clock at `now`: pauses excluded, standing while paused, stopped at the end. */
export function workoutElapsedS(c: WorkoutClockFacts, now: number): number {
  const started = Date.parse(c.started_at);
  if (Number.isNaN(started)) return 0;
  const endedMs = c.ended_at ? Date.parse(c.ended_at) : Number.NaN;
  const pausedAtMs = c.paused_at ? Date.parse(c.paused_at) : Number.NaN;
  const end = !Number.isNaN(endedMs) ? endedMs : !Number.isNaN(pausedAtMs) ? pausedAtMs : now;
  return Math.max(0, Math.floor((end - started - (c.paused_seconds ?? 0) * 1000) / 1000));
}

/** A client stamp, clamped to [started_at, now + slack]; garbage → now. */
export function clampAt(requested: string | null | undefined, startedMs: number, nowMs: number): number {
  const r = requested ? Date.parse(requested) : Number.NaN;
  const base = Number.isNaN(r) ? nowMs : r;
  return Math.min(Math.max(base, startedMs), nowMs + AT_SLACK_MS);
}

export interface FinishPlan {
  endedMs: number;
  /** NULL for an untimed workout. */
  durationSeconds: number | null;
}

/**
 * The finish: when the session is paused, the clock stood at the pause —
 * the end is never before it (the reopen prompt's Finish sends the last
 * activity, which may predate the pause; a naive formula would go negative
 * and INFLATE the duration). The open pause is then excluded like the closed
 * ones. Untimed → no duration at all.
 */
export function finishDuration(c: WorkoutClockFacts, requestedEndMs: number): FinishPlan {
  const started = Date.parse(c.started_at);
  const pausedAtMs = c.paused_at ? Date.parse(c.paused_at) : Number.NaN;
  const endedMs = Math.max(requestedEndMs, Number.isNaN(pausedAtMs) ? -Infinity : pausedAtMs, started);
  if (!isTimed(c)) return { endedMs, durationSeconds: null };
  const openPauseMs = Number.isNaN(pausedAtMs) ? 0 : Math.max(0, endedMs - pausedAtMs);
  const duration = Math.floor((endedMs - started - (c.paused_seconds ?? 0) * 1000 - openPauseMs) / 1000);
  return { endedMs, durationSeconds: Math.max(0, duration) };
}

export type PausePlan =
  | { ok: true; update: { paused_at: string; last_activity_at: string } }
  | { ok: false; status: 400 | 409; error: string };

/** Pause: an active, timed, not-yet-paused session; the stamp is the client's, clamped. */
export function planPause(s: { status: string; timed?: boolean | null; paused_at?: string | null; started_at: string }, requestedAt: string | null | undefined, nowMs: number): PausePlan {
  if (s.status !== 'active') return { ok: false, status: 409, error: 'Workout is already finished' };
  if (!isTimed(s)) return { ok: false, status: 400, error: 'This workout is not timed' };
  if (s.paused_at) return { ok: false, status: 409, error: 'Workout is already paused' };
  const at = new Date(clampAt(requestedAt, Date.parse(s.started_at), nowMs)).toISOString();
  return { ok: true, update: { paused_at: at, last_activity_at: at } };
}

export type ResumePlan =
  | { ok: true; update: { paused_seconds: number; paused_at: null; last_activity_at: string }; /** The compare-and-set: the paused_at value read. */ expectPausedAt: string }
  | { ok: false; status: 409; error: string };

/** Resume: the open pause closes into paused_seconds (computed here — PostgREST cannot write a column-relative value); the CAS is equality on the paused_at read. */
export function planResume(s: { status: string; paused_at?: string | null; paused_seconds?: number | null; started_at: string }, requestedAt: string | null | undefined, nowMs: number): ResumePlan {
  if (s.status !== 'active') return { ok: false, status: 409, error: 'Workout is already finished' };
  if (!s.paused_at) return { ok: false, status: 409, error: 'Workout is not paused' };
  const pausedAtMs = Date.parse(s.paused_at);
  const at = Math.max(clampAt(requestedAt, Date.parse(s.started_at), nowMs), pausedAtMs);
  const pausedSeconds = (s.paused_seconds ?? 0) + Math.max(0, Math.floor((at - pausedAtMs) / 1000));
  return { ok: true, update: { paused_seconds: pausedSeconds, paused_at: null, last_activity_at: new Date(at).toISOString() }, expectPausedAt: s.paused_at };
}
