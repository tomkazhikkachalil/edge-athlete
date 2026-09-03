// ── Join requests (phase 9 V2, both sides in program 11) — the PURE half ────
// The bells' copy, shared by clubs/notify.ts and leagues/notify.ts; the I/O
// lives in join-requests-server.ts. Node-tested.

import type { OrgSide } from './authz';

export function joinRequestTitle(actorName: string, orgName: string): string {
  return `${actorName} asked to join ${orgName}`;
}

export function joinDecisionTitle(orgName: string, approved: boolean): string {
  return approved ? `You're now a member of ${orgName}` : `Your request to join ${orgName} was declined`;
}

/** The welcome line under an approval — what opens up, by side. */
export function joinDecisionMessage(side: OrgSide, approved: boolean): string | null {
  if (!approved) return null;
  return side === 'league'
    ? 'Welcome — the league page, its standings and its news are open to you.'
    : 'Welcome — the club page and its leagues are open to you.';
}

/** The approval queue's table + org column, by side (176 / 177). */
export function joinRequestsTable(side: OrgSide): 'league_join_requests' | 'club_join_requests' {
  return side === 'league' ? 'league_join_requests' : 'club_join_requests';
}
