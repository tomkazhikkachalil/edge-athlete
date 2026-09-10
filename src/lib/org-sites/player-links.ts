// ── Player links (phase 8 P2) — one rule for where a public name points ────
// A public, unsupervised, claimed profile's handle (isPublicProfile) rides
// the public payloads as `playerHandle`. On an org SITE the name links to
// the site's own player page; in the app (the /club|/league/[id]/standings
// twins, the console) it links to the athlete profile. Masked names carry
// no handle and never link. Pure.

import { appBaseUrl } from './urls';

/** Contest Place E3 — one rule for where a contest link points. In the app
 *  it is the relative place; on an org SITE (which may be served from a
 *  custom domain) it is the app's absolute URL, because the contest page
 *  lives in the app (its org-site twin arrives in E4). */
export function contestHref(contestId: string, basePath?: string): string {
  return basePath === undefined ? `/event/${contestId}` : `${appBaseUrl()}/event/${contestId}`;
}

/** `basePath` = the site's base (siteBasePath — '' on a custom domain) for
 *  a player page; omit it for the in-app athlete profile. */
export function playerHref(handle: string, basePath?: string): string {
  return basePath === undefined ? `/u/${encodeURIComponent(handle)}` : `${basePath}/players/${encodeURIComponent(handle)}`;
}
