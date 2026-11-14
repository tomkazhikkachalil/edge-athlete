/**
 * The rollups' reader (Round 3, Sep 2026): `athlete_performances` for one
 * profile × sport, newest first, disputed rows excluded, capped at
 * ROLLUP_ROW_CAP (a season is ~100 events; the cap is a guard, and the
 * result says `truncated` when it bites). For a viewer who is NOT the
 * owner, a `post`-origin row counts only while its post is PUBLIC and
 * PUBLISHED — the fact table carries no visibility snapshot by design, so
 * the origin is re-checked in ≤ 200-id chunks (the scout search's rule).
 * Org-entered and live-round rows are the org's / the round's record and
 * stay. Pre-194 (no table) answers `supported: false`.
 *
 * One game is counted once (Nov 14 2026, `same-game.ts`): a self-posted game
 * that is the same game as an official line — the same contest, or the same
 * date in a sport with two sides — leaves the rollups; the official line is
 * the one that counts. Applied AFTER the visibility filter, so what a viewer
 * may not see never decides what they are shown.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { gameHasSides } from '@/lib/videos/game-rules';
import { computeRollups, ROLLUP_ROW_CAP, type RollupRow, type Rollups } from './rollups';
import { countGames, type CountableGame } from './same-game';

const IN_CHUNK = 200;

export async function readRollups(
  admin: SupabaseClient,
  profileId: string,
  sportKey: string,
  opts: { viewerIsOwner: boolean; trendLength?: number }
): Promise<{ supported: boolean; rollups: Rollups | null }> {
  const schema = getStatSchema(sportKey);
  if (!schema) return { supported: true, rollups: null };

  const { data, error } = await admin
    .from('athlete_performances')
    .select('id, occurred_on, metrics, provenance, source, source_id, source_table, contest_id')
    .eq('profile_id', profileId)
    .eq('sport_key', sportKey)
    .neq('dispute_status', 'disputed')
    .order('occurred_on', { ascending: false })
    .limit(ROLLUP_ROW_CAP + 1);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { supported: false, rollups: null };
    throw new Error(`rollups read failed: ${error.message}`);
  }
  let rows = (data ?? []) as Array<RollupRow & { id: string; source: string; source_id: string; source_table: string; contest_id: string | null }>;
  const truncated = rows.length > ROLLUP_ROW_CAP;
  if (truncated) rows = rows.slice(0, ROLLUP_ROW_CAP);

  if (!opts.viewerIsOwner) {
    const postIds = [...new Set(rows.filter(r => r.source === 'post').map(r => r.source_id))];
    const visible = new Set<string>();
    for (let i = 0; i < postIds.length; i += IN_CHUNK) {
      const { data: posts } = await admin
        .from('posts')
        .select('id')
        .in('id', postIds.slice(i, i + IN_CHUNK))
        .eq('visibility', 'public')
        .eq('status', 'published');
      for (const p of posts ?? []) visible.add(p.id as string);
    }
    rows = rows.filter(r => r.source !== 'post' || visible.has(r.source_id));
  }

  const counted = countGames(rows.map(rollupGame), { matchByDate: gameHasSides(sportKey) });
  rows = rows.filter(r => counted.get(r.id)?.counted !== false);

  return { supported: true, rollups: computeRollups(schema, rows, { truncated, trendLength: opts.trendLength }) };
}

/** A fact row as the same-game rule reads it: an org's contest line is official, everything else is the athlete's own. */
export function rollupGame(r: { id: string; occurred_on: string; source_table: string; contest_id: string | null }): CountableGame {
  return { id: r.id, source: r.source_table === 'contest_stat_lines' ? 'official' : 'post', date: r.occurred_on ? r.occurred_on.slice(0, 10) : null, contestId: r.contest_id };
}
