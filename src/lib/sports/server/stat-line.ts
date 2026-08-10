import { getStatSchema, isStatLineData } from '../stat-schemas';
import { getSportDefinition } from '../SportRegistry';
import type { SportKey } from '../SportRegistry';
import type { ServerSportModule, SportStatsCard } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The generic stats-card builder for every stat-line sport — aggregates
 * PUBLIC posts only (the public profile is the caller). Moved verbatim from
 * api/public/profile; already scales to any sport with a stat schema.
 */
export function statLineServerModule(sportKey: SportKey): ServerSportModule | null {
  const schema = getStatSchema(sportKey);
  if (!schema) return null;
  return {
    async buildStatsCard(profileId: string, supabase: SupabaseClient): Promise<SportStatsCard | null> {
      const { data: statPosts } = await supabase
        .from('posts')
        .select('stats_data')
        .eq('profile_id', profileId)
        .eq('sport_key', sportKey)
        .eq('visibility', 'public')
        .not('stats_data', 'is', null)
        .limit(100);

      const lines = (statPosts || [])
        .map(p => p.stats_data)
        .filter(isStatLineData);

      if (lines.length === 0) return null;

      const totals: Record<string, number> = {};
      for (const line of lines) {
        for (const f of schema.fields) {
          const v = line.stats[f.key];
          if (typeof v === 'number' && Number.isFinite(v)) {
            totals[f.key] = (totals[f.key] ?? 0) + v;
          }
        }
      }
      const topFields = schema.fields
        .filter(f => (totals[f.key] ?? 0) > 0)
        .slice(0, 2);
      const sportDef = getSportDefinition(sportKey);
      return {
        label: `${sportDef.display_name} Stats`,
        tiles: [
          { label: `${schema.activityNoun}s`, value: String(lines.length) },
          ...topFields.map(f => ({ label: f.label, value: String(totals[f.key]) })),
        ].slice(0, 3),
      };
    },
  };
}
