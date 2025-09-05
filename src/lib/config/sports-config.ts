/**
 * Sports configuration
 * Centralized configuration for sport icons, colors, and metadata
 */

import { 
  Trophy,
  Target,
  Activity,
  Zap,
  Shield,
  Dribbble,
  Circle,
  Heart,
  Star,
  Swords,
  Wind,
  Music,
  type LucideIcon
} from 'lucide-react';

/**
 * Sport icon mapping
 * Maps sport keys to their corresponding Lucide icons
 */
export const SPORT_ICONS: Record<string, LucideIcon> = {
  // Track & Field
  track_field: Zap,
  track: Zap,
  field: Target,
  cross_country: Activity,
  
  // Ball Sports
  basketball: Dribbble,
  football: Shield,
  soccer: Circle,
  baseball: Target,
  softball: Circle,
  volleyball: Trophy,
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
  
  // Default
  default: Trophy,
} as const;

/**
 * Sport color mapping
 * Maps sport keys to their brand colors
 */
export const SPORT_COLORS: Record<string, string> = {
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
  
  // Default - Neutral
  default: '#6B7280',
} as const;

/**
 * Sport display names
 * Human-readable names for sports
 */
export const SPORT_NAMES: Record<string, string> = {
  // Track & Field
  track_field: 'Track & Field',
  track: 'Track',
  field: 'Field Events',
  cross_country: 'Cross Country',
  
  // Ball Sports
  basketball: 'Basketball',
  football: 'Football',
  soccer: 'Soccer',
  baseball: 'Baseball',
  softball: 'Softball',
  volleyball: 'Volleyball',
  tennis: 'Tennis',
  golf: 'Golf',
  
  // Water Sports
  swimming: 'Swimming',
  diving: 'Diving',
  water_polo: 'Water Polo',
  
  // Combat Sports
  wrestling: 'Wrestling',
  boxing: 'Boxing',
  martial_arts: 'Martial Arts',
  
  // Winter Sports
  ice_hockey: 'Ice Hockey',
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
} as const;

/**
 * Sport categories
 * Groups sports into logical categories
 */
export const SPORT_CATEGORIES = {
  'Track & Field': ['track_field', 'track', 'field', 'cross_country'],
  'Ball Sports': ['basketball', 'football', 'soccer', 'baseball', 'softball', 'volleyball', 'tennis', 'golf'],
  'Water Sports': ['swimming', 'diving', 'water_polo'],
  'Combat Sports': ['wrestling', 'boxing', 'martial_arts'],
  'Winter Sports': ['ice_hockey', 'skiing', 'snowboarding', 'figure_skating'],
  'Team Sports': ['lacrosse', 'field_hockey', 'rugby'],
  'Individual Sports': ['gymnastics', 'dance', 'cheer', 'bowling'],
} as const;

/**
 * Get sport icon
 * Returns the icon component for a given sport key
 */
export function getSportIcon(sportKey: string): LucideIcon {
  return SPORT_ICONS[sportKey.toLowerCase()] || SPORT_ICONS.default;
}

/**
 * Get sport color
 * Returns the brand color for a given sport key
 */
export function getSportColor(sportKey: string): string {
  return SPORT_COLORS[sportKey.toLowerCase()] || SPORT_COLORS.default;
}

/**
 * Get sport display name
 * Returns the human-readable name for a sport key
 */
export function getSportName(sportKey: string): string {
  return SPORT_NAMES[sportKey.toLowerCase()] || sportKey;
}

/**
 * Get sport category
 * Returns the category for a given sport key
 */
export function getSportCategory(sportKey: string): string | undefined {
  const key = sportKey.toLowerCase();
  for (const [category, sports] of Object.entries(SPORT_CATEGORIES)) {
    if ((sports as readonly string[]).includes(key)) {
      return category;
    }
  }
  return undefined;
}

/**
 * Get all sports
 * Returns all available sport keys
 */
export function getAllSports(): string[] {
  return Object.keys(SPORT_NAMES);
}

/**
 * Get sports by category
 * Returns all sports in a given category
 */
export function getSportsByCategory(category: keyof typeof SPORT_CATEGORIES): readonly string[] {
  return SPORT_CATEGORIES[category] || [];
}

/**
 * Sport metadata type
 */
export interface SportMetadata {
  key: string;
  name: string;
  icon: LucideIcon;
  color: string;
  category?: string;
}

/**
 * Get sport metadata
 * Returns complete metadata for a sport
 */
export function getSportMetadata(sportKey: string): SportMetadata {
  return {
    key: sportKey,
    name: getSportName(sportKey),
    icon: getSportIcon(sportKey),
    color: getSportColor(sportKey),
    category: getSportCategory(sportKey),
  };
}

/**
 * Tailwind color classes for sports
 * Pre-defined Tailwind classes for consistent styling
 */
export const SPORT_TAILWIND_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // Track & Field - Blue
  track_field: { bg: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500' },
  track: { bg: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500' },
  field: { bg: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500' },
  cross_country: { bg: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-500' },
  
  // Ball Sports
  basketball: { bg: 'bg-orange-500', text: 'text-orange-500', border: 'border-orange-500' },
  football: { bg: 'bg-violet-500', text: 'text-violet-500', border: 'border-violet-500' },
  soccer: { bg: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-500' },
  baseball: { bg: 'bg-red-500', text: 'text-red-500', border: 'border-red-500' },
  softball: { bg: 'bg-pink-500', text: 'text-pink-500', border: 'border-pink-500' },
  volleyball: { bg: 'bg-amber-500', text: 'text-amber-500', border: 'border-amber-500' },
  tennis: { bg: 'bg-lime-500', text: 'text-lime-500', border: 'border-lime-500' },
  golf: { bg: 'bg-green-500', text: 'text-green-500', border: 'border-green-500' },
  
  // Water Sports
  swimming: { bg: 'bg-cyan-500', text: 'text-cyan-500', border: 'border-cyan-500' },
  diving: { bg: 'bg-cyan-500', text: 'text-cyan-500', border: 'border-cyan-500' },
  water_polo: { bg: 'bg-sky-500', text: 'text-sky-500', border: 'border-sky-500' },
  
  // Combat Sports
  wrestling: { bg: 'bg-red-600', text: 'text-red-600', border: 'border-red-600' },
  boxing: { bg: 'bg-red-700', text: 'text-red-700', border: 'border-red-700' },
  martial_arts: { bg: 'bg-red-800', text: 'text-red-800', border: 'border-red-800' },
  
  // Winter Sports
  ice_hockey: { bg: 'bg-sky-500', text: 'text-sky-500', border: 'border-sky-500' },
  skiing: { bg: 'bg-sky-400', text: 'text-sky-400', border: 'border-sky-400' },
  snowboarding: { bg: 'bg-sky-300', text: 'text-sky-300', border: 'border-sky-300' },
  figure_skating: { bg: 'bg-indigo-200', text: 'text-indigo-200', border: 'border-indigo-200' },
  
  // Team Sports
  lacrosse: { bg: 'bg-violet-500', text: 'text-violet-500', border: 'border-violet-500' },
  field_hockey: { bg: 'bg-indigo-500', text: 'text-indigo-500', border: 'border-indigo-500' },
  rugby: { bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-600' },
  
  // Individual Sports
  gymnastics: { bg: 'bg-purple-500', text: 'text-purple-500', border: 'border-purple-500' },
  dance: { bg: 'bg-pink-500', text: 'text-pink-500', border: 'border-pink-500' },
  cheer: { bg: 'bg-rose-500', text: 'text-rose-500', border: 'border-rose-500' },
  bowling: { bg: 'bg-slate-500', text: 'text-slate-500', border: 'border-slate-500' },
  
  // Default
  default: { bg: 'bg-gray-500', text: 'text-gray-500', border: 'border-gray-500' },
};

/**
 * Get sport Tailwind classes
 */
export function getSportTailwindClasses(sportKey: string) {
  return SPORT_TAILWIND_COLORS[sportKey.toLowerCase()] || SPORT_TAILWIND_COLORS.default;
}