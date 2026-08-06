/**
 * The `ea-theme` cookie — server truth for the theme, delivered to the device
 * early enough to paint with.
 *
 * WHY A COOKIE WHEN THERE IS ALREADY A localStorage MIRROR: both are
 * per-device, but only the cookie travels with the request, so the middleware
 * (which already talks to Supabase on every navigation) can REFRESH it from
 * profiles.theme_prefs before the page renders. That is what removes the
 * light→dark swap a device used to show when the account's theme had been
 * changed somewhere else — the mirror could only learn about it after the
 * client-side profile fetch, hundreds of ms after first paint.
 *
 * The head script reads this via document.cookie (hence NOT HttpOnly — it is
 * a display preference, never a credential) and falls back to the localStorage
 * mirror when the cookie is absent, which is the signed-out / offline case.
 *
 * Deliberately NOT read in the root layout via next/headers: doing so would
 * opt every route out of static rendering (32 prerendered routes at the time
 * of writing). Reading it in the inline script keeps that build output intact.
 *
 * Encoding is base64url of the sanitized prefs JSON — no '=' padding, no
 * commas or semicolons, so it survives every cookie parser in the stack
 * (including the app's own `=`-splitting one in src/lib/cookies.ts).
 */

import { sanitizeThemePrefs, type ThemePrefs } from './theme-prefs';

export const THEME_COOKIE = 'ea-theme';

/** Long-lived on purpose: freshness is the middleware's job on every document
 *  navigation, so the lifetime only has to outlive a browsing gap. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function encodeThemeCookie(prefs: ThemePrefs): string {
  // Prefs are pure ASCII (enum names, integers, ISO timestamps), so btoa is
  // safe here and works in both the Edge middleware and the browser.
  return btoa(JSON.stringify(prefs))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** null = no server truth on this device (use the localStorage mirror). An
 *  empty object means the account HAS been read and simply has no preference,
 *  which is a different thing and must win over a stale mirror. */
export function decodeThemeCookie(raw: string | undefined | null): ThemePrefs | null {
  if (!raw) return null;
  try {
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const parsed = JSON.parse(atob(b64));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return sanitizeThemePrefs(parsed);
  } catch {
    return null;
  }
}

/**
 * The device's currently-RESOLVED theme ('light' | 'dark'), as opposed to the
 * prefs above. It exists for one consumer: the web manifest
 * (`src/app/manifest.ts`), which needs a splash colour and cannot resolve
 * `scheduled` (needs the device clock) or `system` (needs the OS setting)
 * from prefs alone.
 *
 * Display hint only — never authoritative. The prefs cookie and its
 * middleware refresh remain the source of truth for what the theme IS.
 */
export const THEME_RESOLVED_COOKIE = 'ea-theme-resolved';

export function writeResolvedThemeCookie(resolved: 'light' | 'dark'): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${THEME_RESOLVED_COOKIE}=${resolved}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // storage disabled — the manifest just keeps serving the light default
  }
}

/** Browser-side write, so a preference the user just changed is already on the
 *  next request (and the middleware's refresh agrees rather than fighting it). */
export function writeThemeCookie(prefs: ThemePrefs): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${THEME_COOKIE}=${encodeThemeCookie(prefs)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // storage disabled — the localStorage mirror and server prefs still apply
  }
}
