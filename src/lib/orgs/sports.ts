// ── Derived org sports (0.6b) ───────────────────────────────────────────────
// An org's sport identity is DERIVED from its division structure (145):
// `deriveOrgSports` unions the distinct division sport_keys with the
// league's cached sport_key (clubs have no cache — mig 117 decision), so a
// structureless org keeps showing what creation set and a structured org
// shows what it actually runs.
//
// `leagues.sport_key` stays NOT NULL as a denormalized PRIMARY-sport cache:
// it feeds the search tsvector, search_documents and the sport facet via DB
// triggers (113/115), plus every single-sport display line. The cache is
// refreshed by `refreshLeagueSportCache` on division writes — ONLY when the
// cached sport is no longer among the division sports (most-common wins,
// alphabetical tie-break), and NEVER when the org has no divisions: an
// empty structure is not evidence the creation sport was wrong. The
// recomputePrimaryOwner conventions apply: return the error, never throw,
// never NULL; callers warn-and-continue (a stale sport chip is cosmetic —
// a failed refresh must not fail a division write).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import type { OrgRef } from './members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

/** Most common sport among division rows; ties break alphabetically.
 *  Pure — unit-tested. Empty input → null. */
export function mostCommonSport(sportKeys: string[]): string | null {
  const counts = new Map<string, number>();
  for (const key of sportKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  let best: string | null = null;
  for (const [key, count] of counts) {
    if (!best) {
      best = key;
      continue;
    }
    const bestCount = counts.get(best) ?? 0;
    if (count > bestCount || (count === bestCount && key < best)) best = key;
  }
  return best;
}

/** Display order: the cached sport leads (it's the org's stated identity),
 *  then the rest of the division sports alphabetically. Pure. */
export function orderOrgSports(divisionSports: string[], cachedSport: string | null): string[] {
  const rest = [...new Set(divisionSports)].filter(k => k !== cachedSport).sort();
  return cachedSport ? [cachedSport, ...rest] : rest;
}

async function divisionSportKeys(
  admin: Admin,
  ref: OrgRef
): Promise<{ sportKeys: string[]; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('divisions')
    .select('sport_key')
    .eq(ref.side === 'league' ? 'league_id' : 'club_id', ref.orgId);
  if (error) {
    // Pre-145 database: no divisions table means no derived sports, not a 500.
    if (isMissingTableError(error.code)) return { sportKeys: [], error: null };
    return { sportKeys: [], error };
  }
  return { sportKeys: (data ?? []).map(r => r.sport_key as string), error: null };
}

/** The read-time derivation feeding both org GET payloads. Degrades to the
 *  cached sport alone (league) or [] (club) on any read failure — the org
 *  page must render without its chips before it 500s over them. */
export async function deriveOrgSports(
  admin: Admin,
  ref: OrgRef,
  cachedSport: string | null
): Promise<string[]> {
  const { sportKeys, error } = await divisionSportKeys(admin, ref);
  if (error) {
    console.warn(`[ORG SPORTS] derive failed for ${ref.side} ${ref.orgId}:`, error.message);
    return cachedSport ? [cachedSport] : [];
  }
  return orderOrgSports(sportKeys, cachedSport);
}

/** Refresh the league's primary-sport cache after a division write.
 *  No divisions → no-op; cache still among division sports → no-op;
 *  otherwise the cache becomes the most common division sport. */
export async function refreshLeagueSportCache(
  admin: Admin,
  leagueId: string
): Promise<{ error: PostgrestError | null }> {
  const { sportKeys, error } = await divisionSportKeys(admin, { side: 'league', orgId: leagueId });
  if (error) return { error };
  if (sportKeys.length === 0) return { error: null };

  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .select('id, sport_key')
    .eq('id', leagueId)
    .maybeSingle();
  if (leagueError) return { error: leagueError };
  if (!league || sportKeys.includes(league.sport_key as string)) return { error: null };

  const next = mostCommonSport(sportKeys);
  if (!next) return { error: null };
  const { error: updateError } = await admin
    .from('leagues')
    .update({ sport_key: next })
    .eq('id', leagueId);
  return { error: updateError };
}
