/**
 * Shared constants for the theme localStorage mirror. Own module so the
 * server-rendered head script (theme-script.ts, imported by layout.tsx) and
 * the browser mirror (theme.ts) can both name the key without the layout
 * pulling in browser-only code.
 */

/** Stores the FULL ThemePrefs JSON — not the resolved theme — because the
 *  head script must evaluate the schedule and override before first paint. */
export const THEME_PREFS_KEY = 'ea:theme:v1';

/** Same-tab notification: the native `storage` event does not fire in the
 *  tab that made the write. Mirrors ea:chat-dock-visibility. */
export const THEME_EVENT = 'ea:theme';
