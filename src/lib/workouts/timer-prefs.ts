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

/** The rest targets the athlete saved from the picker (Training fixes PR 3, Oct 21 2026) — a JSON list of seconds, validated by rest.ts. */
export const REST_PRESETS_KEY = 'ea:workout:rest-presets:v1';

export function readRestPresets(parse: (raw: unknown) => number[]): number[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(REST_PRESETS_KEY) : null;
    return parse(raw === null ? [] : JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeRestPresets(list: readonly number[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(REST_PRESETS_KEY);
    else localStorage.setItem(REST_PRESETS_KEY, JSON.stringify(list));
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

// ── Rounds as a swipe (workout fixes, Oct 13 2026) ──────────────────────────
/** How a superset / circuit shows its rounds: `swipe` (the default) or `list` (every round vertically). Remembered on the device. */
export const GROUP_VIEW_KEY = 'ea:workout:group-view:v1';
/** The one-time "Swipe to move between rounds" hint — seen once, on this device. */
export const SWIPE_HINT_KEY = 'ea:workout:swipe-hint:v1';

export function readGroupView(): 'swipe' | 'list' {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(GROUP_VIEW_KEY) === 'list' ? 'list' : 'swipe';
  } catch {
    return 'swipe';
  }
}

export function writeGroupView(view: 'swipe' | 'list'): void {
  try {
    if (view === 'list') localStorage.setItem(GROUP_VIEW_KEY, 'list');
    else localStorage.removeItem(GROUP_VIEW_KEY);
  } catch {
    /* best-effort */
  }
}

export function readSwipeHintSeen(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SWIPE_HINT_KEY) === '1';
  } catch {
    return true; // no storage → never nag
  }
}

export function writeSwipeHintSeen(): void {
  try {
    localStorage.setItem(SWIPE_HINT_KEY, '1');
  } catch {
    /* best-effort */
  }
}

// ── "Time this workout" — the start screen's default (Program E2, Oct 2026) ──
// Someone who runs untimed sessions does not want to switch the clock off
// every time: the last choice on the start screen is the next one's default.
export const TIMED_DEFAULT_KEY = 'ea:workout:timed-default:v1';

export function readTimedDefault(): boolean {
  try {
    return !(typeof localStorage !== 'undefined' && localStorage.getItem(TIMED_DEFAULT_KEY) === '0');
  } catch {
    return true;
  }
}

export function writeTimedDefault(timed: boolean): void {
  try {
    if (timed) localStorage.removeItem(TIMED_DEFAULT_KEY);
    else localStorage.setItem(TIMED_DEFAULT_KEY, '0');
  } catch {
    /* best-effort */
  }
}
