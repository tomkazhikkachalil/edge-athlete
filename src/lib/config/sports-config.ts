/**
 * Sport DISPLAY LEXICON — labels, icons and colors for ARBITRARY sport-key
 * strings. Deliberately a second file next to SportRegistry, not a duplicate
 * of it:
 *
 * - `src/lib/sports/SportRegistry.ts` is the PRODUCT registry: the 10 sports
 *   the platform can actually enable, with metrics, adapters and enablement.
 *   Its key space is a closed union.
 * - This file answers "what do I show for this string?" for the long tail —
 *   `training` (a post category since migration 077), legacy `general` rows,
 *   and the ~20 sports athletes can name in achievements without the
 *   platform supporting them. Its key space is open on purpose; narrowing
 *   achievement pickers to the registry's 10 would be a product regression.
 *
 * Display names for registry sports are DERIVED from SPORT_REGISTRY below,
 * so a rename there propagates here — the two files can no longer drift on
 * the sports they share. Icons (Lucide components — the registry uses
 * FontAwesome class strings) and hex colors stay local: they are
 * display-only and diverge from the registry's brand tokens by design.
 *
 * August 2026: SPORT_CATEGORIES, SPORT_TAILWIND_COLORS, getSportMetadata,
 * getSportCategory, getSportsByCategory and getSportTailwindClasses were
 * deleted — zero consumers.
 */

import {
  Trophy,
  Target,
  Activity,
  Zap,
  Shield,
  CircleDot,
  Volleyball,
  Circle,
  Heart,
  Star,
  Swords,
  Wind,
  Music,
  Dumbbell,
  type LucideIcon
} from 'lucide-react';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

const SPORT_ICONS: Record<string, LucideIcon> = {
  // Track & Field
  track_field: Zap,
  track: Zap,
  field: Target,
  cross_country: Activity,

  // Ball Sports
  // Dribbble was a BRAND icon; lucide v1 removed all of them for trademark
  // reasons. CircleDot is the nearest non-brand ball shape.
  basketball: CircleDot,
  football: Shield,
  soccer: Circle,
  baseball: Target,
  softball: Circle,
  volleyball: Volleyball,   // a real Volleyball icon exists in lucide v1; Trophy was a placeholder
  tennis: Target,
  golf: Trophy,

  // Water Sports
  swimming: Activity,
  diving: Activity,
  water_polo: Circle,

  // Combat Sports
  wrestling: Swords,
  boxing: Shield,
  martial_arts: Swords,

  // Winter Sports
  ice_hockey: Shield,
  skiing: Wind,
  snowboarding: Wind,
  figure_skating: Star,

  // Team Sports
  lacrosse: Target,
  field_hockey: Shield,
  rugby: Shield,

  // Individual Sports
  gymnastics: Star,
  dance: Music,
  cheer: Heart,
  bowling: Circle,

  // Training
  training: Dumbbell,

  // Default
  default: Trophy,
};

const SPORT_COLORS: Record<string, string> = {
  // Track & Field - Electric Blue
  track_field: '#3B82F6',
  track: '#3B82F6',
  field: '#3B82F6',
  cross_country: '#10B981',

  // Ball Sports
  basketball: '#F97316', // Orange
  football: '#8B5CF6', // Purple
  soccer: '#10B981', // Green
  baseball: '#EF4444', // Red
  softball: '#EC4899', // Pink
  volleyball: '#F59E0B', // Amber
  tennis: '#84CC16', // Lime
  golf: '#22C55E', // Emerald

  // Water Sports - Ocean Blue
  swimming: '#06B6D4',
  diving: '#06B6D4',
  water_polo: '#0EA5E9',

  // Combat Sports - Strong Red
  wrestling: '#DC2626',
  boxing: '#B91C1C',
  martial_arts: '#991B1B',

  // Winter Sports - Ice Blue
  ice_hockey: '#0EA5E9',
  skiing: '#38BDF8',
  snowboarding: '#7DD3FC',
  figure_skating: '#E0E7FF',

  // Team Sports
  lacrosse: '#7C3AED', // Violet
  field_hockey: '#6366F1', // Indigo
  rugby: '#059669', // Emerald

  // Individual Sports
  gymnastics: '#A855F7', // Purple
  dance: '#EC4899', // Pink
  cheer: '#F43F5E', // Rose
  bowling: '#64748B', // Slate

  // Training - Violet
  training: '#8B5CF6',

  // Default - Neutral
  default: '#6B7280',
};

/** Registry sports' display names, derived — the single source is SPORT_REGISTRY. */
const REGISTRY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SPORT_REGISTRY).map(([key, def]) => [key, def.display_name])
);

/**
 * Sport display names for arbitrary keys: registry names first, then the
 * long tail this lexicon exists for. Order matters only for getAllSports()
 * (pickers render in this order).
 */
export const SPORT_NAMES: Record<string, string> = {
  ...REGISTRY_NAMES,

  // Track & Field variants
  track: 'Track',
  field: 'Field Events',
  cross_country: 'Cross Country',

  // Ball Sports
  softball: 'Softball',

  // Water Sports
  diving: 'Diving',
  water_polo: 'Water Polo',

  // Combat Sports
  wrestling: 'Wrestling',
  boxing: 'Boxing',
  martial_arts: 'Martial Arts',

  // Winter Sports
  skiing: 'Skiing',
  snowboarding: 'Snowboarding',
  figure_skating: 'Figure Skating',

  // Team Sports
  lacrosse: 'Lacrosse',
  field_hockey: 'Field Hockey',
  rugby: 'Rugby',

  // Individual Sports
  gymnastics: 'Gymnastics',
  dance: 'Dance',
  cheer: 'Cheerleading',
  bowling: 'Bowling',

  // A post category since migration 077, but old rows still carry the key.
  training: 'Training',
};

/** Icon component for a sport key (Trophy for unknown keys). */
export function getSportIcon(sportKey: string): LucideIcon {
  return SPORT_ICONS[sportKey.toLowerCase()] || SPORT_ICONS.default;
}

/** Brand hex for a sport key (neutral gray for unknown keys). */
export function getSportColor(sportKey: string): string {
  return SPORT_COLORS[sportKey.toLowerCase()] || SPORT_COLORS.default;
}

/** Human-readable name for a sport key (the key itself for unknown ones). */
export function getSportName(sportKey: string): string {
  return SPORT_NAMES[sportKey.toLowerCase()] || sportKey;
}

/**
 * Every key this lexicon can label (registry sports + the long tail).
 * NOTE: string[] — distinct from SportRegistry.getAllSports() (definitions)
 * and AdapterRegistry.getAllSports() (adapters).
 */
export function getAllSports(): string[] {
  return Object.keys(SPORT_NAMES);
}
