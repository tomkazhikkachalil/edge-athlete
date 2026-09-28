// ── The public live-scores feed — the READ (sports-team website program, V1) ──
// Viewer-independent by construction: a slug in, the site's PUBLISHED row
// (the ISR reader), its schedule module on, its teams public, the org's games
// (`fetchOrgGames` — the Results page's reader) cached for 10 s under the
// site's tag, projected by `live-feed.ts`. Nothing here may read a session,
// a cookie or a request header (the edge caches the answer for everyone — the
// s-maxage trap).

import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchOrgGames } from '@/lib/teams/org-games-server';
import { getCachedSite } from './cached';
import { isMembersOnly } from './private';
import { appBaseUrl, siteBasePath, siteContestLink } from './urls';
import { projectLiveFeed, type LiveFeed } from './live-feed';

export const LIVE_FEED_CACHE_SECONDS = 10;

/** null = no such public scoreboard (unpublished, private, schedule off). */
export async function readLiveFeed(slug: string, nowMs: number): Promise<LiveFeed | null> {
  const site = await getCachedSite(slug);
  if (!site) return null;
  const scheduleOn = site.modules.some(m => m.module_key === 'schedule' && m.enabled);
  // The feed prints TEAM names: members-only wherever the teams are (a
  // private club) — the Results page's gate, though the schedule stays public.
  if (!scheduleOn || isMembersOnly(site, 'teams')) return null;
  const basePath = siteBasePath(site);
  const games = await unstable_cache(
    () => fetchOrgGames(getSupabaseAdmin(), { side: site.side, orgId: site.orgId, links: { contest: siteContestLink(basePath, site.orgId), event: id => `${appBaseUrl()}/events/${id}` } }),
    ['org-site-live', slug, basePath],
    { revalidate: LIVE_FEED_CACHE_SECONDS, tags: [`org-site:${slug}`] }
  )();
  return projectLiveFeed(games, nowMs);
}
