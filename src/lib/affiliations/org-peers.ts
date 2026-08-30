// ── Org-peer set for the feed's "My orgs" lens ──────────────────────────────
// The lens is a SCOPE, not an access grant: it shows org peers' posts that
// are ALREADY anonymous-visible (post public AND author profile public —
// the activity-server.ts / /u/ rule). The meaningful grant (co-membership
// unlocking followers-visible posts) was declined while org join is open —
// anyone could join an org to see a private member's posts. Recorded in
// DEVLOG (Aug 24) as Tom's explicit decision.

import type { SupabaseClient } from '@supabase/supabase-js';
import { memberOrgIds, memberProfileIdsForOrgs } from '@/lib/orgs/members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** .in() guard for a viewer in enormous orgs — documented truncation, not a
 *  correctness bound (revisit with keyset pagination if it ever bites). */
export const ORG_PEER_CAP = 2000;

/** Pure union across id groups, first-seen order, capped. */
export function unionPeerIds(idGroups: string[][], cap: number = ORG_PEER_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of idGroups) {
    for (const id of group) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Pure lens rule — exactly the anonymous-visible check the org page's
 *  Recent activity uses. */
export function isOrgLensVisible(
  postVisibility: string | null | undefined,
  authorVisibility: string | null | undefined
): boolean {
  return postVisibility === 'public' && authorVisibility === 'public';
}

/** Every member of every org the viewer belongs to (viewer included — their
 *  own posts are always visible anyway). Missing org tables (pre-117 DB)
 *  degrade to [], matching getProfileOrganizations. */
export async function getOrgPeerIds(admin: Admin, profileId: string): Promise<string[]> {
  const { leagueIds, clubIds } = await memberOrgIds(admin, profileId);
  if (leagueIds.length === 0 && clubIds.length === 0) return [];

  const [leaguePeers, clubPeers] = await Promise.all([
    memberProfileIdsForOrgs(admin, 'league', leagueIds),
    memberProfileIdsForOrgs(admin, 'club', clubIds),
  ]);
  return unionPeerIds([leaguePeers, clubPeers]);
}
