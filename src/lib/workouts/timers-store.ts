// ── The rest timer and the stopwatch survive a reload (PR 4) ────────────────
// Screen state under its own device key (not the workout draft — the draft's
// writers stay untouched): the running rest, a held rest, the stopwatch's
// runs. Timestamps only, so a reload reads the same clock. Fail-open.

import { REST_IDLE, STOPWATCH_IDLE, type RestTimer, type Stopwatch } from './rest';

export interface TimersState {
  v: 1;
  rest: RestTimer;
  stopwatch: Stopwatch;
}

export const TIMERS_IDLE: TimersState = { v: 1, rest: REST_IDLE, stopwatch: STOPWATCH_IDLE };

export function timersKey(sessionId: string): string {
  return `ea:workout-timers:v1:${sessionId}`;
}

export function parseTimers(raw: string | null): TimersState {
  if (!raw) return TIMERS_IDLE;
  try {
    const t = JSON.parse(raw) as Partial<TimersState>;
    if (t?.v !== 1) return TIMERS_IDLE;
    const rest: RestTimer = {
      startedAt: typeof t.rest?.startedAt === 'number' ? t.rest.startedAt : null,
      heldS: typeof t.rest?.heldS === 'number' ? t.rest.heldS : null,
      // Oct 22 2026: a device written before the bank has none.
      bankedS: typeof t.rest?.bankedS === 'number' && t.rest.bankedS > 0 ? Math.floor(t.rest.bankedS) : 0,
    };
    const stopwatch: Stopwatch = {
      runningSince: typeof t.stopwatch?.runningSince === 'number' ? t.stopwatch.runningSince : null,
      accumulatedMs: typeof t.stopwatch?.accumulatedMs === 'number' && t.stopwatch.accumulatedMs >= 0 ? t.stopwatch.accumulatedMs : 0,
      // Oct 23 2026: a device written before the modes counts up with no target.
      mode: t.stopwatch?.mode === 'down' ? 'down' : 'up',
      targetMs: typeof t.stopwatch?.targetMs === 'number' && t.stopwatch.targetMs > 0 ? t.stopwatch.targetMs : null,
      leadInUntil: typeof t.stopwatch?.leadInUntil === 'number' ? t.stopwatch.leadInUntil : null,
    };
    return { v: 1, rest, stopwatch };
  } catch {
    return TIMERS_IDLE;
  }
}

export function readTimers(sessionId: string): TimersState {
  try {
    return parseTimers(window.localStorage.getItem(timersKey(sessionId)));
  } catch {
    return TIMERS_IDLE;
  }
}

export function writeTimers(sessionId: string, state: TimersState): void {
  try {
    // The mode and the target are preferences (timer-prefs.ts), not idleness: with no time the key goes.
    const idle = state.rest.startedAt === null && state.rest.heldS === null && state.rest.bankedS === 0 && state.stopwatch.runningSince === null && state.stopwatch.accumulatedMs === 0 && state.stopwatch.leadInUntil === null;
    if (idle) window.localStorage.removeItem(timersKey(sessionId));
    else window.localStorage.setItem(timersKey(sessionId), JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}

export function clearTimers(sessionId: string): void {
  try {
    window.localStorage.removeItem(timersKey(sessionId));
  } catch {
    /* best-effort */
  }
}
