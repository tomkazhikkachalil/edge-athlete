/**
 * Does this visitor want less data? (Oct 9 2026 — lifted out of the
 * site-live island so the app has ONE rule.) Two signals the browser gives:
 * `navigator.connection.saveData` (Chrome's Data Saver / Lite mode) and the
 * `prefers-reduced-data` media query. Either means: do not start optional
 * network work on your own — the live scoreboard does not poll, the activity
 * page shows the route's line drawing instead of a tiled map until asked.
 *
 * The rule is pure (`reducedDataFrom`) so it unit-tests in node; the reader
 * (`prefersReducedData`) touches the browser and is feature-checked for the
 * iOS 15 floor (neither signal exists there — the answer is "no").
 */

export interface ReducedDataEnv {
  saveData?: boolean;
  reducedData?: boolean;
}

/** True when either signal asks for less data. */
export function reducedDataFrom(env: ReducedDataEnv): boolean {
  return env.saveData === true || env.reducedData === true;
}

/** The browser's own answer; false on the server and on browsers without either signal. */
export function prefersReducedData(): boolean {
  if (typeof window === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-data: reduce)').matches : false;
  return reducedDataFrom({ saveData: conn?.saveData === true, reducedData: mq });
}
