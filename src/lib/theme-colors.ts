/**
 * The browser-chrome colours (address bar on Android Chrome, status bar tint
 * on iOS Safari, installed-PWA title bar) for each theme.
 *
 * ONE source of truth, imported by three places that must never disagree:
 *   - src/app/layout.tsx      → the `viewport.themeColor` metas Next renders
 *   - src/lib/theme-script.ts → sets them pre-paint, from the resolved theme
 *   - src/lib/use-theme.ts    → re-sets them when the theme changes at runtime
 *
 * WHY THE SCRIPT TOUCHES THEM AT ALL: Next renders two metas scoped with
 * `media="(prefers-color-scheme: …)"`, and browsers evaluate that against the
 * OS — not against our `data-theme` attribute. So a dark app on a light-OS
 * phone kept a violet bar above dark content. Writing the resolved colour
 * into BOTH metas makes whichever one the OS matches give the same answer,
 * which is what stops the OS from disagreeing with the app.
 */

export const THEME_COLOR = {
  light: '#7c3aed', // brand violet-600
  dark: '#171310', // the dark canvas
} as const;

/**
 * The installed-app (PWA) colours, served from the web manifest.
 *
 * `background_color` is the splash screen the OS paints while the app boots —
 * a light lavender flash before a near-black app was the tell that the
 * manifest didn't know about themes. `theme_color` stays brand violet in both:
 * it tints OS chrome (Android's task switcher, desktop PWA title bar), where
 * brand identity beats theme matching.
 *
 * These CANNOT be updated from the page like the meta tags are — the OS reads
 * the manifest outside the document — so `src/app/manifest.ts` picks the pair
 * per request using the `ea-theme-resolved` cookie.
 */
export const MANIFEST_COLORS = {
  light: { theme: THEME_COLOR.light, background: '#f5f3ff' }, // violet-50
  dark: { theme: THEME_COLOR.light, background: THEME_COLOR.dark },
} as const;

export type ResolvedThemeName = keyof typeof MANIFEST_COLORS;

/** Anything unrecognised (absent cookie, junk, credentials stripped from the
 *  manifest fetch) resolves to light — i.e. exactly the pre-adaptive output. */
export function manifestColorsFor(raw: string | undefined | null) {
  return raw === 'dark' ? MANIFEST_COLORS.dark : MANIFEST_COLORS.light;
}
