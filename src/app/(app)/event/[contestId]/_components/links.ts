import type { ContestView } from '@/lib/competitions/contest-view';
import { playerHref } from '@/lib/org-sites/player-links';
import type { ContestLinks } from '@/components/contests/ContestPage';

/** The in-app link set: org page, standings twin, athlete profile, live round. */
export function appContestLinks(view: ContestView, publicSite: string | null = null): ContestLinks {
  const base = `/${view.org.side}/${view.org.id}`;
  return {
    publicSite,
    org: base,
    standings: `${base}/standings`,
    player: handle => playerHref(handle),
    live: groupPostId => `/live/${groupPostId}`,
  };
}
