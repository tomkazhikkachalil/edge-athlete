// ── Sanctioned pairs — the server read behind the pure chain resolver ─────
// Lifted from official-stats.ts (phase 6 R3) so the contest view can derive
// the 'sanctioned' display tier the same way the athlete's Official log
// does: club edges by the CLUBS in play (any league may sanction), the
// league chain walked up from the owners + direct sanctioners in ≤3 bounded
// batched reads, then resolveSanctionedPairs under the common-authority
// rule. Pre-167 (no league_affiliations) the chain read fails → single-hop.
// Never throws; any failure reads as "nothing sanctioned".

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSanctionedPairs, type ClubSanctionEdge, type LeagueSanctionEdge } from './provenance';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the authz.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

/** `"${ownerLeagueId}:${clubId}"` pairs — resolveSanctionedPairs' key. */
export async function readSanctionedPairs(
  admin: Admin,
  ownerLeagueIds: string[],
  clubIds: string[]
): Promise<Set<string>> {
  if (ownerLeagueIds.length === 0 || clubIds.length === 0) return new Set();
  try {
    const { data: clubEdgeRows } = await admin
      .from('league_clubs')
      .select('league_id, club_id')
      .in('club_id', clubIds)
      .eq('status', 'active')
      .eq('affiliation_type', 'sanctioned_by')
      .limit(1000);
    const clubEdges: ClubSanctionEdge[] = (clubEdgeRows ?? []).map(e => ({
      leagueId: e.league_id as string,
      clubId: e.club_id as string,
    }));

    const leagueEdges: LeagueSanctionEdge[] = [];
    let frontier = [...new Set([...ownerLeagueIds, ...clubEdges.map(e => e.leagueId)])];
    const seen = new Set(frontier);
    for (let hop = 0; hop < 3 && frontier.length > 0; hop++) {
      const { data: parentRows, error } = await admin
        .from('league_affiliations')
        .select('league_id, parent_league_id')
        .in('league_id', frontier)
        .eq('status', 'active')
        .eq('affiliation_type', 'sanctioned_by')
        .limit(500);
      if (error) break;
      const next: string[] = [];
      for (const e of parentRows ?? []) {
        leagueEdges.push({ leagueId: e.league_id as string, parentLeagueId: e.parent_league_id as string });
        const p = e.parent_league_id as string;
        if (!seen.has(p)) {
          seen.add(p);
          next.push(p);
        }
      }
      frontier = next;
    }
    return resolveSanctionedPairs(clubEdges, leagueEdges, ownerLeagueIds);
  } catch {
    return new Set();
  }
}
