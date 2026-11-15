/**
 * "These are two different games" (migration 309, Nov 14 2026) — the one
 * reader and writer of `stat_game_distinct`. Server only. The same-game rule
 * (same-game.ts) matches two games of one date; the athlete — or a guardian —
 * says here that a pair is a doubleheader, and both count. A database without
 * the table answers an empty set / "not available here yet": the rule then
 * simply runs without overrides.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { distinctKey } from './same-game';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper, as in rollups-server.ts
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[STATS distinct]';
const isMissing = (code: string | undefined) => code === '42P01' || code === 'PGRST205';
/** A season has a handful of doubleheaders; the cap is a guard. */
export const DISTINCT_MAX = 500;

export interface DistinctPair { a: string; b: string }

/** The pairs this athlete has said are two games in this sport. */
export async function readDistinctPairs(admin: Admin, profileId: string, sportKey: string): Promise<DistinctPair[]> {
  const { data, error } = await admin.from('stat_game_distinct').select('game_a, game_b').eq('profile_id', profileId).eq('sport_key', sportKey).limit(DISTINCT_MAX);
  if (error) {
    if (!isMissing(error.code)) console.error(`${TAG} read failed:`, error.message);
    return [];
  }
  return ((data ?? []) as Array<{ game_a: string; game_b: string }>).map(r => ({ a: r.game_a, b: r.game_b }));
}

/** The same pairs as the rule takes them. */
export function distinctSet(pairs: readonly DistinctPair[]): Set<string> {
  return new Set(pairs.map(p => distinctKey(p.a, p.b)));
}

export type DistinctOutcome = { ok: true } | { ok: false; status: 500 | 503; error: string };

/** Say a pair is two games (`distinct: true`), or take it back. `a` < `b` (parseDistinctBody). Saying it twice is saying it once. */
export async function setDistinctPair(admin: Admin, profileId: string, userId: string, pair: { sport: string; a: string; b: string; distinct: boolean }): Promise<DistinctOutcome> {
  if (!pair.distinct) {
    const { error } = await admin.from('stat_game_distinct').delete().eq('profile_id', profileId).eq('game_a', pair.a).eq('game_b', pair.b);
    if (error && !isMissing(error.code)) {
      console.error(`${TAG} delete failed:`, error.message);
      return { ok: false, status: 500, error: 'Could not save that' };
    }
    return { ok: true };
  }
  const { error } = await admin.from('stat_game_distinct').insert({ profile_id: profileId, sport_key: pair.sport, game_a: pair.a, game_b: pair.b, created_by_user_id: userId });
  if (error && error.code !== '23505') {
    if (isMissing(error.code)) return { ok: false, status: 503, error: 'This is not available here yet' };
    console.error(`${TAG} insert failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not save that' };
  }
  return { ok: true };
}
