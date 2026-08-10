import type { SupabaseClient } from '@supabase/supabase-js';

/** The generic stats-card shape the public profile renders blindly. */
export interface SportStatsCard {
  label: string;
  tiles: Array<{ label: string; value: string }>;
}

/**
 * Server-side per-sport module — the seam the client-side SportAdapter can't
 * provide (adapters are fetch-based; API routes run on the admin client).
 * Starts with exactly one surface; grow it only when a route needs a seam,
 * never speculatively.
 */
export interface ServerSportModule {
  /** The public profile's stats card, or null when there's nothing to show. */
  buildStatsCard(profileId: string, supabase: SupabaseClient): Promise<SportStatsCard | null>;
}
