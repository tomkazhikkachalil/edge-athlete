// ── "Hide timer" — remembered on this device (Tom, Oct 12 2026) ─────────────
// A display preference, not data: someone who hides the clock once does not
// want it next workout either. localStorage, fail-open (a private window or
// blocked storage shows the clock).

export const TIMER_HIDDEN_KEY = 'ea:workout:timer-hidden:v1';

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
