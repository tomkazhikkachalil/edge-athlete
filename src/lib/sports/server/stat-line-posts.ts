import type { SupabaseClient } from '@supabase/supabase-js';

// ── The stat-line posts behind a Stats card (gaps round, Sep 26 2026) ─────────
// ONE reader for both stat-line modules (the generic one and track & field).
// A STRANGER's card counts public posts only; the OWNER's (self or guardian —
// the caller decides, and only a viewer-dependent route with a private cache
// may ask) counts every line, as /api/performance/rollups already does. The
// CDN-cached /u/ payload never passes `includePrivate`.

export interface StatsCardView {
  includePrivate?: boolean;
}

export async function fetchStatLinePosts(
  supabase: SupabaseClient,
  profileId: string,
  sportKey: string,
  limit: number,
  view: StatsCardView = {}
): Promise<unknown[]> {
  let query = supabase.from('posts').select('stats_data').eq('profile_id', profileId).eq('sport_key', sportKey);
  if (!view.includePrivate) query = query.eq('visibility', 'public');
  const { data } = await query.not('stats_data', 'is', null).limit(limit);
  return (data || []).map(p => (p as { stats_data: unknown }).stats_data);
}
