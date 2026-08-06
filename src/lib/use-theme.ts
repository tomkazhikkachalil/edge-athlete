'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_SCHEDULE,
  isOverrideActive,
  resolveTheme,
  sanitizeThemePrefs,
  type ResolvedTheme,
  type ThemePrefs,
} from './theme-prefs';
import { readStoredThemePrefs, writeStoredThemePrefs, subscribeThemePrefs } from './theme';
import { writeThemeCookie, writeResolvedThemeCookie } from './theme-cookie';
import { THEME_COLOR } from './theme-colors';

/**
 * The one theme evaluator. Module-level singleton, not a context provider,
 * for the same reason as useLiveNow: the state is global by nature, and a
 * provider would force a root-layout remount story for something every
 * subscriber can share through one set + one interval.
 *
 * ThemeApplier (mounted in the root layout) keeps a permanent subscription,
 * so the listeners below are alive for the whole app session:
 *  - 30s interval        → scheduled windows flip while the tab sits open
 *  - visibilitychange    → a backgrounded tab catches up on foreground
 *  - storage/CustomEvent → another tab (or this one) changed the prefs
 *  - matchMedia change   → live OS appearance flips in 'system' mode
 *
 * The DOM write is one attribute (data-theme on <html>); everything visual
 * is CSS vars, so toggling is instant and reload-free.
 */

const EVAL_MS = 30_000;

let prefs: ThemePrefs | null = null; // null = mirror not read yet
let theme: ResolvedTheme = 'light';
const subscribers = new Set<() => void>();
let detachListeners: (() => void) | null = null;

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function getPrefs(): ThemePrefs {
  if (prefs === null) prefs = readStoredThemePrefs();
  return prefs;
}

/** Stamp <html> and notify hooks. Idempotent. */
function applyResolved() {
  const next = resolveTheme(getPrefs(), new Date(), systemPrefersDark());
  const changed = next !== theme;
  theme = next;
  try {
    if (next === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    // Browser chrome follows the app, not the OS. Both metas get the same
    // colour so whichever one the OS media query matches agrees with us —
    // otherwise a dark app on a light-OS phone keeps a violet address bar.
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach(meta => meta.setAttribute('content', THEME_COLOR[next]));
    // Lets the web manifest serve a matching splash colour — the OS reads the
    // manifest outside the page, so it can only learn the theme via a cookie.
    writeResolvedThemeCookie(next);
  } catch {
    // non-browser — nothing to stamp
  }
  if (changed) subscribers.forEach(fn => fn());
}

/** Set prefs locally (module + mirror + cookie) and re-apply. No server write.
 *  The cookie matters as much as the mirror: it is what the next document
 *  load's head script paints from, so skipping it would reintroduce a swap on
 *  the very next navigation. */
function setLocalPrefs(next: ThemePrefs) {
  prefs = next;
  writeStoredThemePrefs(next);
  writeThemeCookie(next);
  applyResolved();
}

function persistToServer(next: ThemePrefs): Promise<Response> {
  return fetch('/api/settings/theme', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(next),
  });
}

/** Re-resolve now; also lazily strip an override once a boundary passes.
 *  Correctness never depends on the strip (isOverrideActive computes expiry
 *  identically everywhere) — it is hygiene so stale overrides don't sit in
 *  the mirror and the DB forever. */
function evaluate() {
  const current = getPrefs();
  if (
    current.mode === 'scheduled' &&
    current.override &&
    !isOverrideActive(current.override, current.schedule ?? DEFAULT_SCHEDULE, new Date())
  ) {
    const next = { ...current };
    delete next.override;
    setLocalPrefs(next);
    persistToServer(next).catch(() => {
      // signed-out or offline — the computed expiry already handled the theme
    });
    return;
  }
  applyResolved();
}

function attachListeners() {
  const unsubscribePrefs = subscribeThemePrefs(incoming => {
    prefs = incoming;
    applyResolved();
  });
  const onVisible = () => {
    if (document.visibilityState === 'visible') evaluate();
  };
  document.addEventListener('visibilitychange', onVisible);

  let media: MediaQueryList | null = null;
  const onMediaChange = () => evaluate();
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', onMediaChange);
  } catch {
    media = null;
  }

  const interval = setInterval(evaluate, EVAL_MS);

  detachListeners = () => {
    unsubscribePrefs();
    document.removeEventListener('visibilitychange', onVisible);
    media?.removeEventListener('change', onMediaChange);
    clearInterval(interval);
    detachListeners = null;
  };
}

/** Optimistic save with rollback: applies immediately, then persists; on
 *  failure restores the previous prefs and returns false. */
export async function saveThemePrefs(next: ThemePrefs): Promise<boolean> {
  const clean = sanitizeThemePrefs(next);
  const previous = getPrefs();
  setLocalPrefs(clean);
  try {
    const res = await persistToServer(clean);
    if (!res.ok) throw new Error(`theme save ${res.status}`);
    return true;
  } catch {
    setLocalPrefs(previous);
    return false;
  }
}

/** The quick toggle. Off↔On for the simple modes; in Scheduled it writes the
 *  until-next-transition override; in System it switches to an explicit
 *  mode, because "follow the OS, except not right now" isn't a state the
 *  schedule can resume from. */
export function toggleThemeNow(): Promise<boolean> {
  const current = getPrefs();
  const opposite: ResolvedTheme =
    resolveTheme(current, new Date(), systemPrefersDark()) === 'dark' ? 'light' : 'dark';
  let next: ThemePrefs;
  if ((current.mode ?? 'off') === 'scheduled') {
    next = {
      ...current,
      override: { theme: opposite, setAt: new Date().toISOString() },
    };
  } else {
    next = { ...current, mode: opposite === 'dark' ? 'on' : 'off' };
  }
  return saveThemePrefs(next);
}

/** Server truth arriving (ThemeApplier): overwrite the device copies iff they
 *  differ. No PATCH back — this IS the server value.
 *
 *  The cookie is refreshed even when nothing changed, so its lifetime keeps
 *  extending on an active session and a browser that dropped it (privacy
 *  settings, a cleared jar) gets it back without waiting for a preference
 *  change. */
export function adoptServerThemePrefs(raw: unknown) {
  const clean = sanitizeThemePrefs(raw);
  if (JSON.stringify(clean) === JSON.stringify(getPrefs())) {
    writeThemeCookie(clean);
    return;
  }
  setLocalPrefs(clean);
}

export interface UseThemeResult {
  /** 'light' during SSR and the hydration render; correct from the first
   *  post-mount effect. CSS (data-theme, stamped pre-paint by the head
   *  script) is never waiting on this — only JS consumers are. */
  theme: ResolvedTheme;
  prefs: ThemePrefs;
  savePrefs: (next: ThemePrefs) => Promise<boolean>;
  toggleNow: () => Promise<boolean>;
}

export function useTheme(): UseThemeResult {
  const [snapshot, setSnapshot] = useState<{ theme: ResolvedTheme; prefs: ThemePrefs }>({
    theme: 'light',
    prefs: {},
  });

  useEffect(() => {
    const update = () => setSnapshot({ theme, prefs: getPrefs() });
    subscribers.add(update);
    if (subscribers.size === 1) attachListeners();
    evaluate();
    update();
    return () => {
      subscribers.delete(update);
      if (subscribers.size === 0) detachListeners?.();
    };
  }, []);

  return {
    theme: snapshot.theme,
    prefs: snapshot.prefs,
    savePrefs: saveThemePrefs,
    toggleNow: toggleThemeNow,
  };
}
