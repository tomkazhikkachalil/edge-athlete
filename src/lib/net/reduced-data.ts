/**
 * Does this visitor want less data? (Oct 9 2026.) Two signals the browser
 * gives: `navigator.connection.saveData` (Chrome's Data Saver / Lite mode)
 * and the `prefers-reduced-data` media query. Either means: do not start
 * optional network work on your own — the activity page shows the route's
 * line drawing instead of a tiled map until asked.
 *
 * The public site's live scoreboard asks the same question with its own
 * two lines: guardrail B4.11 pins that island to React and the pure feed
 * modules, so it cannot import this file. The two are kept EQUAL by test
 * (`autoPollAllowed` is `reducedDataFrom`'s complement) — change one, change
 * the other.
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
