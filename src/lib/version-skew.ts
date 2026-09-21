/**
 * Version skew (Round 1 PR 8, Sep 2026). A deploy replaces every hashed
 * chunk; a tab opened before it fails its next lazy import with a
 * ChunkLoadError (Chrome), "Importing a module script failed" (Safari) or
 * "Failed to fetch dynamically imported module" (Firefox). The user sees
 * "Something went wrong" and "Try again" cannot help — the chunk is gone.
 * Vercel's Skew Protection (a project setting; Pro plans) keeps the old
 * deployment's chunks reachable for a day; this is the floor beneath it:
 * recognise the error, reload ONCE, and say why when the reload did not
 * help. Pure, so it is unit-tested; the boundary does the reload.
 */
const CHUNK_MESSAGE = /Loading (?:CSS )?chunk [^\s]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isChunkLoadError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  return typeof error.message === 'string' && CHUNK_MESSAGE.test(error.message);
}

export const SKEW_RELOAD_KEY = 'ea:skew-reload';

/**
 * Whether the boundary should reload now, given what the tab remembers of
 * its last skew reload (the sessionStorage value: the timestamp it reloaded
 * at). One reload per WINDOW_MS: the second failure in a row is shown, not
 * looped — a genuinely broken deploy must not spin the tab.
 */
export const SKEW_RELOAD_WINDOW_MS = 60_000;
export function shouldReloadForSkew(lastReloadAt: string | null | undefined, now: number): boolean {
  const last = lastReloadAt ? Number(lastReloadAt) : NaN;
  if (!Number.isFinite(last)) return true;
  return now - last > SKEW_RELOAD_WINDOW_MS;
}
