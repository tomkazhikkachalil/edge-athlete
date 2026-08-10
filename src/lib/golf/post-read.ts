import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Golf's post-hydration read path — the one place the posts API attaches
 * golf_rounds (+ sorted holes) to post rows. All three GET call sites
 * (single post, POST response, batched feed) route through here, so a
 * second deep-table sport has exactly one hydration slot to mirror.
 * Behavior-preserving: same select, same hole sort.
 */

const GOLF_ROUND_SELECT = `
  *,
  golf_holes (
    hole_number,
    par,
    strokes,
    putts,
    fairway_hit,
    green_in_regulation,
    distance_yards,
    club_off_tee,
    notes
  )
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortHoles(round: any) {
  if (round && round.golf_holes) {
    round.golf_holes.sort(
      (a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number
    );
  }
  return round ?? null;
}

/** Single round with sorted holes (single-post GET + POST response). */
export async function fetchGolfRoundById(supabase: SupabaseClient, roundId: string) {
  const { data } = await supabase
    .from('golf_rounds')
    .select(GOLF_ROUND_SELECT)
    .eq('id', roundId)
    .single();
  return sortHoles(data);
}

/** Batched rounds keyed by id (the feed's one-query-per-page enrichment). */
export async function fetchGolfRoundsByIds(supabase: SupabaseClient, roundIds: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, any>();
  if (roundIds.length === 0) return { byId, error: null };
  const { data, error } = await supabase
    .from('golf_rounds')
    .select(GOLF_ROUND_SELECT)
    .in('id', roundIds);
  for (const round of data || []) {
    byId.set(round.id, sortHoles(round));
  }
  return { byId, error };
}
