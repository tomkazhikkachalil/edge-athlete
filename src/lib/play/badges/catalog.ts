import { STAT_SCHEMAS } from '@/lib/sports/stat-schemas';

/**
 * The badge catalog — the Play program (244). Pure DATA, client-safe: the
 * server evaluates it (evaluate.ts), the trophy case renders it. A badge
 * earned is a `badge_awards` row; a badge DEFINED lives only here.
 *
 * Every sport gets badges without code:
 *  • per sport (every FEATURE sport): first result, 10 / 25 / 50 / 100
 *    results, first win, first verified result;
 *  • a stat-line sport's single-game milestones are GENERATED from
 *    `StatFieldDef.milestones` in stat-schemas.ts ("20 Points", "Hat
 *    trick") — adding a sport, or a milestone, is a data edit there;
 *  • golf's pack is hand-written (its facts are the round's, not a stat
 *    line's): break 100 / 90 / 80 / 70, under par, first birdie, birdie
 *    barrage, first eagle, hole-in-one, handicap under 20 / 10 / 5 / scratch;
 *  • across sports: two and three sports played.
 *
 * Keys are namespaced `<sport>.<badge>` (`all.` across sports) — 244's
 * CHECK, and UNIQUE (profile_id, badge_key). A key, once shipped, is
 * FOREVER (it is stored); rename the label, never the key.
 */

export type BadgeTier = 'bronze' | 'silver' | 'gold';

export type BadgeRule =
  /** The athlete's results in this sport reach `min` (the first result is 1). */
  | { kind: 'results'; min: number }
  /** A result in this sport that was a win. */
  | { kind: 'win' }
  /** A verified result in this sport (official / org-recorded). */
  | { kind: 'verified' }
  /** One result's metric reaches the value (`gte`) or gets under it (`lte`),
   *  over exactly `holes` holes when named. */
  | { kind: 'metric'; metric: string; op: 'gte' | 'lte'; value: number; holes?: number }
  /** A (non-provisional) golf handicap index at or below the value. */
  | { kind: 'handicap'; atMost: number }
  /** Results in at least `min` different sports. */
  | { kind: 'sports'; min: number };

export interface BadgeDef {
  key: string;
  /** null = across sports. */
  sportKey: string | null;
  label: string;
  description: string;
  /** A Font Awesome solid icon name. */
  icon: string;
  tier: BadgeTier;
  rule: BadgeRule;
}

/** The sports that get the per-sport pack (FEATURE_SPORTS — kept in step by test). */
export const BADGE_SPORTS: readonly string[] = ['golf', 'ice_hockey', 'volleyball', 'basketball', 'soccer', 'baseball', 'track_field'];

const COUNT_STEPS: ReadonlyArray<{ min: number; slug: string; label: string; tier: BadgeTier }> = [
  { min: 1, slug: 'first_result', label: 'First one in the books', tier: 'bronze' },
  { min: 10, slug: 'results_10', label: 'Regular', tier: 'bronze' },
  { min: 25, slug: 'results_25', label: 'Committed', tier: 'silver' },
  { min: 50, slug: 'results_50', label: 'Veteran', tier: 'silver' },
  { min: 100, slug: 'results_100', label: 'Centurion', tier: 'gold' },
];

function noun(sportKey: string): string {
  if (sportKey === 'golf') return 'round';
  if (sportKey === 'track_field') return 'meet';
  return (STAT_SCHEMAS[sportKey as keyof typeof STAT_SCHEMAS]?.activityNoun ?? 'game').toLowerCase();
}

function perSportPack(sportKey: string): BadgeDef[] {
  const n = noun(sportKey);
  const out: BadgeDef[] = COUNT_STEPS.map(step => ({
    key: `${sportKey}.${step.slug}`,
    sportKey,
    label: step.label,
    description: step.min === 1 ? `Logged your first ${n}.` : `Logged ${step.min} ${n}s.`,
    icon: step.min === 1 ? 'fa-flag' : 'fa-layer-group',
    tier: step.tier,
    rule: { kind: 'results', min: step.min },
  }));
  if (sportKey !== 'golf' && sportKey !== 'track_field') {
    out.push({ key: `${sportKey}.first_win`, sportKey, label: 'First win', description: `Won a ${n}.`, icon: 'fa-trophy', tier: 'bronze', rule: { kind: 'win' } });
  }
  out.push({ key: `${sportKey}.first_verified`, sportKey, label: 'On the record', description: `A verified ${n} — recorded by a club, league or sanctioning body.`, icon: 'fa-certificate', tier: 'silver', rule: { kind: 'verified' } });
  return out;
}

function milestonePack(): BadgeDef[] {
  const out: BadgeDef[] = [];
  for (const schema of Object.values(STAT_SCHEMAS)) {
    const n = schema.activityNoun.toLowerCase();
    for (const field of schema.fields) {
      const steps = field.milestones ?? [];
      steps.forEach((m, i) => {
        const value = typeof m === 'number' ? m : m.value;
        const named = typeof m === 'number' ? null : m.label;
        out.push({
          key: `${schema.sport_key}.${field.key}_${value}`,
          sportKey: schema.sport_key,
          label: named ?? `${value} ${field.label}`,
          description: value === 1 ? `${field.label.replace(/s$/, '')} in a ${n}.` : `${value} or more ${field.label.toLowerCase()} in one ${n}.`,
          icon: 'fa-star',
          tier: i === 0 ? 'bronze' : i === 1 ? 'silver' : 'gold',
          rule: { kind: 'metric', metric: field.key, op: 'gte', value },
        });
      });
    }
  }
  return out;
}

const GOLF_PACK: BadgeDef[] = [
  { key: 'golf.break_100', sportKey: 'golf', label: 'Broke 100', description: 'Shot 99 or better over 18 holes.', icon: 'fa-golf-ball-tee', tier: 'bronze', rule: { kind: 'metric', metric: 'gross', op: 'lte', value: 99, holes: 18 } },
  { key: 'golf.break_90', sportKey: 'golf', label: 'Broke 90', description: 'Shot 89 or better over 18 holes.', icon: 'fa-golf-ball-tee', tier: 'bronze', rule: { kind: 'metric', metric: 'gross', op: 'lte', value: 89, holes: 18 } },
  { key: 'golf.break_80', sportKey: 'golf', label: 'Broke 80', description: 'Shot 79 or better over 18 holes.', icon: 'fa-golf-ball-tee', tier: 'silver', rule: { kind: 'metric', metric: 'gross', op: 'lte', value: 79, holes: 18 } },
  { key: 'golf.break_70', sportKey: 'golf', label: 'Broke 70', description: 'Shot 69 or better over 18 holes.', icon: 'fa-golf-ball-tee', tier: 'gold', rule: { kind: 'metric', metric: 'gross', op: 'lte', value: 69, holes: 18 } },
  { key: 'golf.under_par', sportKey: 'golf', label: 'Red number', description: 'Finished 18 holes under par.', icon: 'fa-fire', tier: 'gold', rule: { kind: 'metric', metric: 'to_par', op: 'lte', value: -1, holes: 18 } },
  { key: 'golf.first_birdie', sportKey: 'golf', label: 'First birdie', description: 'Made a birdie.', icon: 'fa-dove', tier: 'bronze', rule: { kind: 'metric', metric: 'birdies', op: 'gte', value: 1 } },
  { key: 'golf.birdie_barrage', sportKey: 'golf', label: 'Birdie barrage', description: 'Three or more birdies in one round.', icon: 'fa-dove', tier: 'silver', rule: { kind: 'metric', metric: 'birdies', op: 'gte', value: 3 } },
  { key: 'golf.first_eagle', sportKey: 'golf', label: 'Eagle', description: 'Made an eagle (or better).', icon: 'fa-feather', tier: 'gold', rule: { kind: 'metric', metric: 'eagles', op: 'gte', value: 1 } },
  { key: 'golf.hole_in_one', sportKey: 'golf', label: 'Hole-in-one', description: 'An ace.', icon: 'fa-bullseye', tier: 'gold', rule: { kind: 'metric', metric: 'aces', op: 'gte', value: 1 } },
  { key: 'golf.handicap_20', sportKey: 'golf', label: 'Handicap under 20', description: 'A handicap index of 20.0 or lower.', icon: 'fa-chart-line', tier: 'bronze', rule: { kind: 'handicap', atMost: 20 } },
  { key: 'golf.handicap_10', sportKey: 'golf', label: 'Single digits', description: 'A handicap index of 10.0 or lower.', icon: 'fa-chart-line', tier: 'silver', rule: { kind: 'handicap', atMost: 10 } },
  { key: 'golf.handicap_5', sportKey: 'golf', label: 'Handicap under 5', description: 'A handicap index of 5.0 or lower.', icon: 'fa-chart-line', tier: 'gold', rule: { kind: 'handicap', atMost: 5 } },
  { key: 'golf.handicap_0', sportKey: 'golf', label: 'Scratch', description: 'A handicap index of 0.0 or better.', icon: 'fa-crown', tier: 'gold', rule: { kind: 'handicap', atMost: 0 } },
];

const CROSS_SPORT: BadgeDef[] = [
  { key: 'all.two_sports', sportKey: null, label: 'Two-sport athlete', description: 'Results in two different sports.', icon: 'fa-shuffle', tier: 'silver', rule: { kind: 'sports', min: 2 } },
  { key: 'all.three_sports', sportKey: null, label: 'All-rounder', description: 'Results in three different sports.', icon: 'fa-medal', tier: 'gold', rule: { kind: 'sports', min: 3 } },
];

export const BADGES: readonly BadgeDef[] = [
  ...BADGE_SPORTS.flatMap(perSportPack),
  ...GOLF_PACK,
  ...milestonePack(),
  ...CROSS_SPORT,
];

const BY_KEY = new Map(BADGES.map(b => [b.key, b]));

/** A stored key → its definition; `undefined` for a key the catalog no longer defines (render it plainly, never crash). */
export function badgeDef(key: string): BadgeDef | undefined {
  return BY_KEY.get(key);
}

export const TIER_ORDER: Record<BadgeTier, number> = { gold: 0, silver: 1, bronze: 2 };
