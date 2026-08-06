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
