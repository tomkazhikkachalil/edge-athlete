import type { SupabaseClient } from '@supabase/supabase-js';
import { getSportDefinition, type SportKey } from '../SportRegistry';
import { computeActiveSports } from '../active-sports';
import {
  COMPETITIVE_LEVEL_KEY,
  getSportSettingsDisplay,
  type SettingsDisplayItem,
} from '../settings-schemas';
import { golfServerModule } from './golf';
import { statLineServerModule } from './stat-line';
import { trackFieldServerModule } from './track-field';
import type { ServerSportModule, SkillCardContribution, SportSkillCard, SportStatsCard } from './types';

export type {
  ServerSportModule,
  SkillCardContext,
  SkillCardContribution,
  SkillMetric,
  SkillProgress,
  SkillProvenance,
  SkillTile,
  SportSkillCard,
  SportStatsCard,
} from './types';

/**
 * Named server modules — explicit static imports only (no dynamic import();
 * Next bundling). A sport absent here falls back to the generic stat-line
 * module when it has a stat schema, else contributes nothing.
 */
const SERVER_SPORT_MODULES: Partial<Record<SportKey, ServerSportModule>> = {
  golf: golfServerModule,
  // Named because the generic stat-line card SUMS values — nonsense for race
  // times, where the aggregate that matters is the per-event minimum (PB).
  track_field: trackFieldServerModule,
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

// ── Skill cards ───────────────────────────────────────────────────────────────

/**
 * Assemble one sport's card from the module's tracked contribution plus the
 * display-shaped settings items (pure — the unit-testable core).
 *
 * When the sport has no computed headline, the self-reported competitive
 * level is promoted from the chips to the headline (provenance stays
 * 'entered' — a claimed level must never read as a measured one). A card
 * with nothing at all to show is omitted entirely: onboarding writes an
 * empty `{}` settings row per declared sport, so "row exists" must never
 * mean "card renders".
 */
export function assembleSkillCard(
  sportKey: SportKey,
  contribution: SkillCardContribution | null,
  displayItems: SettingsDisplayItem[]
): SportSkillCard | null {
  let headline = contribution?.headline ?? null;
  const consumed = new Set(contribution?.consumedEnteredKeys ?? []);
  let entered = displayItems.filter(i => !consumed.has(i.key));

  if (!headline) {
    const level = entered.find(i => i.key === COMPETITIVE_LEVEL_KEY);
    if (level) {
      headline = { value: level.value, label: level.label, provenance: 'entered' };
      entered = entered.filter(i => i.key !== COMPETITIVE_LEVEL_KEY);
    }
  }

  const tiles = contribution?.tiles ?? [];
  const progress = contribution?.progress ?? null;
  if (!headline && !progress && tiles.length === 0 && entered.length === 0) return null;

  return {
    sportKey,
    sportLabel: getSportDefinition(sportKey).display_name,
    headline,
    progress,
    tiles,
    entered,
    detailHref: contribution?.detailHref ?? null,
  };
}

/**
 * One card per sport the athlete plays, in active-sports order (declared
 * sport first). Caller owns the privacy gate — this reads whatever the given
 * client can see. Sports with nothing to show contribute no card.
 */
export async function buildSportSkillCards(
  profileId: string,
  supabase: SupabaseClient
): Promise<SportSkillCard[]> {
  // Same union as /api/profile/[id]/active-sports: declared label ∪ posted
  // sports ∪ intake-declared sport_settings rows (settings fetched here too,
  // once, so modules never re-query them).
  const [{ data: profile }, { data: postSportKeys, error: rpcError }, { data: settingsRows }] =
    await Promise.all([
      supabase.from('profiles').select('sport').eq('id', profileId).single(),
      supabase.rpc('get_profile_post_sport_keys', { p_profile_id: profileId }),
      supabase.from('sport_settings').select('sport_key, settings').eq('profile_id', profileId),
    ]);

  // Loud, not silent: a missing RPC would quietly drop every posted sport.
  if (rpcError) console.error('[skill-cards] get_profile_post_sport_keys failed:', rpcError);

  const ordered = computeActiveSports({
    declaredSport: profile?.sport ?? null,
    postSportKeys: (postSportKeys as string[] | null) ?? [],
    settingsSportKeys: (settingsRows || []).map(s => s.sport_key as string),
  });

  // Widen the union with non-post activity: computeActiveSports only sees
  // declared ∪ posted ∪ settings rows, so a golfer with logged rounds but
  // none of those would get no golf card despite a computable handicap.
  // Named modules with their own activity tables opt in via hasActivity
  // (one head-count each, and only when the sport isn't already active).
  const activityChecks = await Promise.all(
    (Object.entries(SERVER_SPORT_MODULES) as Array<[SportKey, ServerSportModule]>)
      .filter(([key, mod]) => !!mod.hasActivity && !ordered.includes(key))
      .map(async ([key, mod]) =>
        (await mod.hasActivity!(profileId, supabase)) ? key : null
      )
  );
  for (const key of activityChecks) {
    if (key) ordered.push(key);
  }

  const settingsBySport = new Map<string, Record<string, unknown> | null>(
    (settingsRows || []).map(s => [s.sport_key as string, s.settings as Record<string, unknown> | null])
  );

  const cards = await Promise.all(
    ordered.map(async sportKey => {
      const mod = getServerSportModule(sportKey);
      const settings = settingsBySport.get(sportKey) ?? null;
      const contribution = mod?.buildSkillCard
        ? await mod.buildSkillCard(profileId, supabase, { settings })
        : null;
      return assembleSkillCard(sportKey, contribution, getSportSettingsDisplay(sportKey, settings));
    })
  );

  return cards.filter((c): c is SportSkillCard => c !== null);
}
