/**
 * Browser mirror of the account theme preference (profiles.theme_prefs).
 *
 * localStorage is the device's last-known copy so the head script
 * (theme-script.ts) can resolve the theme before first paint; the server
 * column is the truth and overwrites the mirror whenever the profile loads
 * (ThemeApplier). Shape mirrors chat-dock-visibility.ts: try/catch around
 * every storage touch, a CustomEvent for same-tab updates, the native
 * `storage` event for cross-tab ones.
 */

import { sanitizeThemePrefs, type ThemePrefs } from './theme-prefs';
import { THEME_PREFS_KEY, THEME_EVENT } from './theme-storage-keys';

export function readStoredThemePrefs(): ThemePrefs {
  try {
    const raw = window.localStorage.getItem(THEME_PREFS_KEY);
    if (!raw) return {};
    return sanitizeThemePrefs(JSON.parse(raw));
  } catch {
    // private mode / garbage JSON — light defaults
    return {};
  }
}

export function writeStoredThemePrefs(prefs: ThemePrefs): void {
  try {
    window.localStorage.setItem(THEME_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / quota — the event below still updates this session
  }
  try {
    window.dispatchEvent(new CustomEvent<ThemePrefs>(THEME_EVENT, { detail: prefs }));
  } catch {
    // no CustomEvent (non-browser) — nothing to notify
  }
}

/** Subscribe to pref changes from this tab (CustomEvent) and other tabs
 *  (storage). Returns a cleanup for useEffect. */
export function subscribeThemePrefs(onChange: (prefs: ThemePrefs) => void): () => void {
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<ThemePrefs>).detail;
    onChange(detail && typeof detail === 'object' ? detail : readStoredThemePrefs());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_PREFS_KEY) return;
    onChange(readStoredThemePrefs());
  };

  window.addEventListener(THEME_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}
