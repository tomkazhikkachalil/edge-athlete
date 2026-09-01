import type { SupabaseClient } from '@supabase/supabase-js';
import type { SportKey } from '../SportRegistry';
import type { SettingsDisplayItem } from '../settings-schemas';

/** The generic stats-card shape the public profile renders blindly. */
export interface SportStatsCard {
  label: string;
  tiles: Array<{ label: string; value: string }>;
}

// ── Skill cards ───────────────────────────────────────────────────────────────
// One card per sport an athlete plays, each expressing skill in that sport's
// native language (golf → computed handicap; team sports → level played;
// track → PB times). Every metric carries provenance. The original two
// rungs: 'tracked' = computed from real app data, 'entered' = self-reported
// by the athlete. Phase 4 widens the ladder with the ORG rungs (masterplan
// §7 — "display the tier; a scout will interrogate it"): 'sanctioned' /
// 'league_verified' / 'club_recorded' ride contest_stat_lines entered by
// competition owners and team staff; 'imported' labels migrated history.
// An official line stored 'self_reported' displays as 'entered' — same
// meaning, one vocabulary. The client renders these blindly — the rank
// order lives in sports/server/official-stats.ts.

export type SkillProvenance =
  | 'sanctioned'
  | 'league_verified'
  | 'club_recorded'
  | 'tracked'
  | 'imported'
  | 'entered';

/** The sport's headline skill metric — front and center on the card. */
export interface SkillMetric {
  value: string;
  label: string;
  provenance: SkillProvenance;
  /** Trailing context, e.g. "· 14 rds". */
  detail?: string;
}

/** Graceful pre-metric state, e.g. 1 of 3 rated rounds toward a handicap. */
export interface SkillProgress {
  count: number;
  needed: number;
  /** What is being counted, e.g. "rated rounds". */
  label: string;
  /** How to make progress, e.g. "Log rounds with a course rating & slope…". */
  hint?: string;
}

export interface SkillTile {
  label: string;
  value: string;
  provenance: SkillProvenance;
}

export interface SportSkillCard {
  sportKey: SportKey;
  sportLabel: string;
  headline: SkillMetric | null;
  progress: SkillProgress | null;
  tiles: SkillTile[];
  /** Self-reported settings chips (already display-shaped, minus any item
   *  promoted to the headline). */
  entered: SettingsDisplayItem[];
  /** Tap target for the card owner (e.g. golf → trends), or null. */
  detailHref: string | null;
}

/** That sport's `sport_settings.settings`, fetched once by the dispatcher. */
export interface SkillCardContext {
  settings: Record<string, unknown> | null;
}

/** The TRACKED parts a sport module contributes; the dispatcher assembles the
 *  card and owns all entered-data handling, so modules never touch settings. */
export interface SkillCardContribution {
  headline?: SkillMetric | null;
  progress?: SkillProgress | null;
  tiles?: SkillTile[];
  detailHref?: string | null;
  /** Settings keys this contribution already rendered (e.g. a self-reported
   *  PB lifted into a tile) — the assembler drops them from the chips so the
   *  same fact never shows twice. */
  consumedEnteredKeys?: string[];
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
  /** Tracked skill-card parts, or null when the sport has none to compute. */
  buildSkillCard?(
    profileId: string,
    supabase: SupabaseClient,
    ctx: SkillCardContext
  ): Promise<SkillCardContribution | null>;
  /**
   * Whether the profile has real activity in this sport OUTSIDE posts —
   * golf rounds live in their own tables, so a golfer who logged rounds but
   * never posted, declared the sport, or filled its settings would otherwise
   * not count as playing it. Only sports with non-post activity implement
   * this; the skill-card dispatcher uses it to widen the active-sports
   * union.
   */
  hasActivity?(profileId: string, supabase: SupabaseClient): Promise<boolean>;
}
