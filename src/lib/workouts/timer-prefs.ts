// ── "Hide timer" — remembered on this device (Tom, Oct 12 2026) ─────────────
// A display preference, not data: someone who hides the clock once does not
// want it next workout either. localStorage, fail-open (a private window or
// blocked storage shows the clock).

export const TIMER_HIDDEN_KEY = 'ea:workout:timer-hidden:v1';
/** The rest timer's target (PR 4), seconds; absent = no target. */
export const REST_TARGET_KEY = 'ea:workout:rest-target:v1';

export function readRestTarget(): number | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(REST_TARGET_KEY) : null;
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeRestTarget(seconds: number | null): void {
  try {
    if (seconds === null) localStorage.removeItem(REST_TARGET_KEY);
    else localStorage.setItem(REST_TARGET_KEY, String(seconds));
  } catch {
    /* best-effort */
  }
}

export function readTimerHidden(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TIMER_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTimerHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(TIMER_HIDDEN_KEY, '1');
    else localStorage.removeItem(TIMER_HIDDEN_KEY);
  } catch {
    /* best-effort */
  }
}
