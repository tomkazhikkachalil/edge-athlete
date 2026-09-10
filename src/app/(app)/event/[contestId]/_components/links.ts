import type { ContestView } from '@/lib/competitions/contest-view';
import { playerHref } from '@/lib/org-sites/player-links';
import type { ContestLinks } from './ContestPage';

/** The in-app link set: org page, standings twin, athlete profile, live round. */
export function appContestLinks(view: ContestView): ContestLinks {
  const base = `/${view.org.side}/${view.org.id}`;
  return {
    org: base,
    standings: `${base}/standings`,
    player: handle => playerHref(handle),
    live: groupPostId => `/live/${groupPostId}`,
  };
}
