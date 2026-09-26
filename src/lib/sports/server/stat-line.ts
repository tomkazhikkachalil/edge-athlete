import { getStatSchema, isStatLineData } from '../stat-schemas';
import { getSportDefinition } from '../SportRegistry';
import type { SportKey } from '../SportRegistry';
import type { ServerSportModule, SportStatsCard } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchStatLinePosts, type StatsCardView } from './stat-line-posts';

/**
 * The generic stats-card builder for every stat-line sport — aggregates
 * PUBLIC posts, or every post on the owner's view (`fetchStatLinePosts`).
 * Moved from api/public/profile; already scales to any sport with a stat
 * schema.
 */
export function statLineServerModule(sportKey: SportKey): ServerSportModule | null {
  const schema = getStatSchema(sportKey);
  if (!schema) return null;
  const mod: ServerSportModule = {
    async buildStatsCard(profileId: string, supabase: SupabaseClient, view?: StatsCardView): Promise<SportStatsCard | null> {
      const lines = (await fetchStatLinePosts(supabase, profileId, sportKey, 100, view)).filter(isStatLineData);

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

    // Stat-line sports have no computed headline metric — the level played is
    // self-reported and the dispatcher promotes it from settings. Tracked
    // contribution = the post aggregates as tiles (the owner's view counts
    // private lines too).
    async buildSkillCard(profileId: string, supabase: SupabaseClient, ctx) {
      const card = await mod.buildStatsCard(profileId, supabase, { includePrivate: ctx.includePrivate });
      return {
        tiles: (card?.tiles ?? []).map(t => ({ ...t, provenance: 'tracked' as const })),
      };
    },
  };
  return mod;
}
