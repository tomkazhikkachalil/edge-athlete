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
  gold: { text: 'text-amber-500', chip: 'bg-amber-100 text-amber-800', circle: 'bg-amber-100' },
  silver: { text: 'text-gray-400', chip: 'bg-gray-100 text-gray-700', circle: 'bg-gray-100' },
  bronze: { text: 'text-amber-800', chip: 'bg-amber-50 text-amber-900', circle: 'bg-amber-50' },
  podium: { text: 'text-amber-600', chip: 'bg-amber-100 text-amber-800', circle: 'bg-amber-100' },
};

const NEUTRAL: TierAccent = { text: 'text-gray-400', chip: 'bg-gray-100 text-gray-700', circle: 'bg-gray-100' };

export function tierAccent(tier: PlacementTier | null): TierAccent {
  return tier ? TIER_ACCENTS[tier] : NEUTRAL;
}
