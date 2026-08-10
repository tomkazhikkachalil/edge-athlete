import type { SupabaseClient } from '@supabase/supabase-js';
import type { SportKey } from '../SportRegistry';
import { golfServerModule } from './golf';
import { statLineServerModule } from './stat-line';
import type { ServerSportModule, SportStatsCard } from './types';

export type { ServerSportModule, SportStatsCard } from './types';

/**
 * Named server modules — explicit static imports only (no dynamic import();
 * Next bundling). A sport absent here falls back to the generic stat-line
 * module when it has a stat schema, else contributes nothing.
 */
const SERVER_SPORT_MODULES: Partial<Record<SportKey, ServerSportModule>> = {
  golf: golfServerModule,
};

export function getServerSportModule(sportKey: SportKey | null): ServerSportModule | null {
  if (!sportKey) return null;
  return SERVER_SPORT_MODULES[sportKey] ?? statLineServerModule(sportKey);
}

/** One-call dispatch for routes: the sport's stats card, or null. */
export async function buildSportStatsCard(
  sportKey: SportKey | null,
  profileId: string,
  supabase: SupabaseClient
): Promise<SportStatsCard | null> {
  const mod = getServerSportModule(sportKey);
  return mod ? mod.buildStatsCard(profileId, supabase) : null;
}
