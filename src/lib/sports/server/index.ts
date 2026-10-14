import type { SupabaseClient } from '@supabase/supabase-js';
import { getSportDefinition, type SportKey, SPORT_REGISTRY } from '../SportRegistry';
import { computeActiveSports } from '../active-sports';
import { orderProfileSports } from '../profile-sports-order';
import { resolveSportKey } from '../resolve-sport-key';
import {
  COMPETITIVE_LEVEL_KEY,
  getSportSettingsDisplay,
  type SettingsDisplayItem,
} from '../settings-schemas';
import { getStatSchema } from '../stat-schemas';
import { golfServerModule } from './golf';
import {
  fetchOfficialStatLines,
  mergeOfficialContribution,
  type OfficialStatLine,
} from './official-stats';
import { statLineServerModule } from './stat-line';
import { trackFieldServerModule } from './track-field';
import type { StatsCardView } from './stat-line-posts';
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
  supabase: SupabaseClient,
  view?: StatsCardView
): Promise<SportStatsCard | null> {
  const mod = getServerSportModule(sportKey);
  return mod ? mod.buildStatsCard(profileId, supabase, view) : null;
}

// ── Skill cards ───────────────────────────────────────────────────────────────

/**
 * Assemble one sport's card from the module's tracked contribution plus the
 * display-shaped settings items (pure — the unit-testable core).
 *
 * When the sport has no computed headline, the self-reported competitive
 * level is promoted from the chips to the headline (provenance stays
 * 'entered' — a claimed level must never read as a measured one). A card
 * with nothing at all to show is an EMPTY card (`state: 'empty'`, "No stats
 * yet") — never null (sports on the profile, Oct 14 2026: every sport the
 * person has shows, golf gets no special treatment). The caller decides
 * whether an empty card LISTS: declared sports always do; a sport known only
 * from posts does not (buildSportSkillCards).
 */
export function assembleSkillCard(
  sportKey: SportKey,
  contribution: SkillCardContribution | null,
  displayItems: SettingsDisplayItem[],
  pin: { pinned: boolean; pinOrder: number | null } = { pinned: false, pinOrder: null }
): SportSkillCard {
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
  const empty = !headline && !progress && tiles.length === 0 && entered.length === 0;
  const def = getSportDefinition(sportKey);

  return {
    sportKey,
    sportLabel: def.display_name,
    headline,
    progress,
    tiles,
    entered,
    detailHref: contribution?.detailHref ?? null,
    enabled: def.enabled,
    state: empty ? 'empty' : 'data',
    pinned: pin.pinned,
    pinOrder: pin.pinOrder,
  };
}

/**
 * One card per sport the athlete plays — PINNED sports first (the athlete's
 * pin order), then the declared primary, then registry order (the ONE rule,
 * profile-sports-order.ts; the strip, the Stats chips and /u/ share it).
 * Caller owns the privacy gate — this reads whatever the given client can
 * see. A DECLARED sport (profiles.sport, a sport_settings row, official
 * lines, logged rounds) always gets a card, empty or not; a sport known ONLY
 * from posted sport_keys gets one only when it has something to show — a
 * draft or hidden post never surfaces a sport to a stranger. `view`
 * defaults to the STRANGER's (public lines only); only a viewer-dependent
 * route with a private cache passes the owner's.
 */
export async function buildSportSkillCards(
  profileId: string,
  supabase: SupabaseClient,
  view: StatsCardView = {}
): Promise<SportSkillCard[]> {
  // Same union as /api/profile/[id]/active-sports: declared label ∪ posted
  // sports ∪ intake-declared sport_settings rows (settings fetched here too,
  // once, so modules never re-query them).
  const [
    { data: profile },
    { data: postSportKeys, error: rpcError },
    { data: settingsRows },
    officialLines,
  ] = await Promise.all([
    supabase.from('profiles').select('sport').eq('id', profileId).single(),
    supabase.rpc('get_profile_post_sport_keys', { p_profile_id: profileId }),
    readSettingsRows(supabase, profileId),
    // Phase 4: org-entered stat lines from PUBLIC competitions (degrades
    // to [] pre-157 or on an RLS-limited client — never throws).
    fetchOfficialStatLines(supabase, profileId),
  ]);

  // Loud, not silent: a missing RPC would quietly drop every posted sport.
  if (rpcError) console.error('[skill-cards] get_profile_post_sport_keys failed:', rpcError);

  const ordered = computeActiveSports({
    declaredSport: profile?.sport ?? null,
    postSportKeys: (postSportKeys as string[] | null) ?? [],
    settingsSportKeys: (settingsRows || []).map(s => s.sport_key as string),
  });

  // Official lines widen the union too: an athlete whose only hockey
  // record is coach-entered still gets a hockey card.
  const officialBySport = new Map<string, OfficialStatLine[]>();
  for (const line of officialLines) {
    if (!officialBySport.has(line.sportKey)) officialBySport.set(line.sportKey, []);
    officialBySport.get(line.sportKey)!.push(line);
  }
  for (const key of officialBySport.keys()) {
    if (!ordered.includes(key as SportKey)) ordered.push(key as SportKey);
  }

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
  const pinBySport = new Map<string, { pinned: boolean; pinOrder: number | null }>(
    (settingsRows || []).map(s => [s.sport_key as string, { pinned: s.pinned === true, pinOrder: s.pinned === true && typeof s.pin_order === 'number' ? s.pin_order : null }])
  );
  // Declared = everything but "posted only": the label, a settings row,
  // official lines, a module's own activity (golf rounds).
  const declared = new Set<string>();
  const declaredKey = resolveSportKey(profile?.sport ?? null);
  if (declaredKey) declared.add(declaredKey);
  for (const s of settingsRows || []) declared.add(s.sport_key as string);
  for (const key of officialBySport.keys()) declared.add(key);
  for (const key of activityChecks) if (key) declared.add(key);

  const cards = await Promise.all(
    ordered.map(async sportKey => {
      const mod = getServerSportModule(sportKey);
      const settings = settingsBySport.get(sportKey) ?? null;
      const contribution = mod?.buildSkillCard
        ? await mod.buildSkillCard(profileId, supabase, { settings, includePrivate: view.includePrivate })
        : null;
      // Phase 4: official tiles replace same-label tracked tiles
      // (verified beats tracked; provenance = the conservative minimum).
      const merged = mergeOfficialContribution(
        contribution,
        officialBySport.get(sportKey) ?? [],
        getStatSchema(sportKey)
      );
      return assembleSkillCard(sportKey, merged, getSportSettingsDisplay(sportKey, settings), pinBySport.get(sportKey));
    })
  );

  const listed = cards.filter(c => c.state === 'data' || declared.has(c.sportKey));
  const byKey = new Map(listed.map(c => [c.sportKey as string, c]));
  const { pinned, rest } = orderProfileSports({
    active: listed.map(c => c.sportKey),
    pins: listed.filter(c => c.pinned).map(c => ({ key: c.sportKey, order: c.pinOrder ?? Number.MAX_SAFE_INTEGER })),
    primary: declaredKey,
    registryOrder: Object.keys(SPORT_REGISTRY),
  });
  return [...pinned, ...rest].map(k => byKey.get(k)!).filter(Boolean);
}

/** The profile's sport_settings rows WITH the pin columns (263); before 263
 *  (42703 / PGRST204) the same rows without them — a missing column is
 *  "no pins", never a 500. */
async function readSettingsRows(supabase: SupabaseClient, profileId: string) {
  const withPins = await supabase.from('sport_settings').select('sport_key, settings, pinned, pin_order').eq('profile_id', profileId);
  if (!withPins.error) return withPins;
  if (withPins.error.code !== '42703' && withPins.error.code !== 'PGRST204') return withPins;
  const plain = await supabase.from('sport_settings').select('sport_key, settings').eq('profile_id', profileId);
  return { data: (plain.data ?? []).map(r => ({ ...r, pinned: false, pin_order: null })), error: plain.error };
}
