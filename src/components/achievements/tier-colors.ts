/**
 * Medal-tier accents as LITERAL Tailwind classes (interpolated tokens get
 * purged by JIT — same rule as vitals/category-colors). Values wear ink;
 * these classes go on glyphs and chips only.
 */

import type { PlacementTier } from '@/lib/achievements/display';

export interface TierAccent {
  /** Glyph tint. */
  text: string;
  /** Soft chip: background + text. */
  chip: string;
  /** 40px icon-circle background. */
  circle: string;
}

const TIER_ACCENTS: Record<PlacementTier, TierAccent> = {
  gold: { text: 'text-amber-500 dark:text-amber-400', chip: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200', circle: 'bg-amber-100 dark:bg-amber-950/60' },
  silver: { text: 'text-faint', chip: 'bg-surface-sunken text-secondary', circle: 'bg-surface-sunken' },
  bronze: { text: 'text-amber-800 dark:text-amber-200', chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200', circle: 'bg-amber-50 dark:bg-amber-950/40' },
  podium: { text: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200', circle: 'bg-amber-100 dark:bg-amber-950/60' },
};

const NEUTRAL: TierAccent = { text: 'text-faint', chip: 'bg-surface-sunken text-secondary', circle: 'bg-surface-sunken' };

export function tierAccent(tier: PlacementTier | null): TierAccent {
  return tier ? TIER_ACCENTS[tier] : NEUTRAL;
}
