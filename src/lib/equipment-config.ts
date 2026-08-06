/**
 * Sport-aware equipment category catalogs — the single source of truth for
 * the Add Equipment modal and the Equipment tab display (replaces the
 * golf-only lists previously duplicated in both components).
 *
 * athlete_equipment.category is TEXT in the DB, so unknown/free-text
 * categories (General items, legacy data) are expected — getCategoryConfig
 * always returns a safe fallback rather than throwing.
 */

import { getEnabledSports } from '@/lib/sports/SportRegistry';

export interface EquipmentCategoryDef {
  value: string;
  label: string;
  icon: string; // emoji
  color: string; // Tailwind chip classes
}

const GRAY = 'bg-gray-100 text-gray-700 dark:bg-stone-800 dark:text-stone-300';

export const EQUIPMENT_CATEGORIES: Record<string, EquipmentCategoryDef[]> = {
  golf: [
    { value: 'driver', label: 'Driver', icon: '🏌️', color: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
    { value: 'fairway_wood', label: 'Fairway Wood', icon: '🌲', color: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
    { value: 'hybrid', label: 'Hybrid', icon: '⚡', color: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300' },
    { value: 'iron_set', label: 'Iron Set', icon: '⛳', color: GRAY },
    { value: 'wedge', label: 'Wedge', icon: '🎯', color: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
    { value: 'putter', label: 'Putter', icon: '⛳', color: 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300' },
    { value: 'ball', label: 'Ball', icon: '⚪', color: 'bg-white text-gray-700 border border-gray-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700' },
    { value: 'shoes', label: 'Shoes', icon: '👟', color: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
    { value: 'glove', label: 'Glove', icon: '🧤', color: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' },
    { value: 'bag', label: 'Bag', icon: '🎒', color: 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300' },
    { value: 'rangefinder', label: 'Rangefinder', icon: '📏', color: 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300' },
    { value: 'other', label: 'Other', icon: '🔧', color: GRAY },
  ],
  ice_hockey: [
    { value: 'stick', label: 'Stick', icon: '🏒', color: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
    { value: 'skates', label: 'Skates', icon: '⛸️', color: 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300' },
    { value: 'helmet', label: 'Helmet', icon: '🪖', color: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
    { value: 'gloves', label: 'Gloves', icon: '🧤', color: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' },
    { value: 'pads', label: 'Pads', icon: '🛡️', color: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
    { value: 'jersey', label: 'Jersey', icon: '👕', color: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
    { value: 'bag', label: 'Bag', icon: '🎒', color: 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300' },
    { value: 'other', label: 'Other', icon: '🔧', color: GRAY },
  ],
  volleyball: [
    { value: 'shoes', label: 'Shoes', icon: '👟', color: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
    { value: 'knee_pads', label: 'Knee Pads', icon: '🦵', color: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
    { value: 'ball', label: 'Ball', icon: '🏐', color: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
    { value: 'ankle_braces', label: 'Ankle Braces', icon: '🦶', color: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300' },
    { value: 'apparel', label: 'Apparel', icon: '👕', color: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
    { value: 'bag', label: 'Bag', icon: '🎒', color: 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300' },
    { value: 'other', label: 'Other', icon: '🔧', color: GRAY },
  ],
  basketball: [
    { value: 'shoes', label: 'Shoes', icon: '👟', color: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
    { value: 'ball', label: 'Ball', icon: '🏀', color: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
    { value: 'apparel', label: 'Apparel', icon: '👕', color: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
    { value: 'accessories', label: 'Accessories', icon: '🎽', color: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300' },
    { value: 'bag', label: 'Bag', icon: '🎒', color: 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300' },
    { value: 'other', label: 'Other', icon: '🔧', color: GRAY },
  ],
  soccer: [
    { value: 'cleats', label: 'Cleats', icon: '👟', color: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
    { value: 'shin_guards', label: 'Shin Guards', icon: '🦵', color: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
    { value: 'ball', label: 'Ball', icon: '⚽', color: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
    { value: 'gloves', label: 'Goalkeeper Gloves', icon: '🧤', color: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' },
    { value: 'apparel', label: 'Apparel', icon: '👕', color: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
    { value: 'bag', label: 'Bag', icon: '🎒', color: 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300' },
    { value: 'other', label: 'Other', icon: '🔧', color: GRAY },
  ],
  baseball: [
    { value: 'bat', label: 'Bat', icon: '🏏', color: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
    { value: 'glove', label: 'Glove', icon: '🧤', color: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' },
    { value: 'cleats', label: 'Cleats', icon: '👟', color: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
    { value: 'helmet', label: 'Helmet', icon: '🪖', color: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
    { value: 'batting_gloves', label: 'Batting Gloves', icon: '🤾', color: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300' },
    { value: 'bag', label: 'Bag', icon: '🎒', color: 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300' },
    { value: 'other', label: 'Other', icon: '🔧', color: GRAY },
  ],
  // 'general' has no fixed list — the modal shows a free-text type input
};

/** Curated category list for a sport; empty for 'general' / unknown sports. */
export function getEquipmentCategories(sportKey: string): EquipmentCategoryDef[] {
  return EQUIPMENT_CATEGORIES[sportKey] ?? [];
}

/** "knee_pads" → "Knee Pads"; free text passes through with words capitalized. */
function humanizeCategory(category: string): string {
  return category
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Display config for any (sport, category) pair. NEVER throws — unknown or
 * free-text categories (General items, legacy rows) get a neutral fallback.
 */
export function getCategoryConfig(sportKey: string, category: string): EquipmentCategoryDef {
  const match = getEquipmentCategories(sportKey).find(c => c.value === category);
  if (match) return match;
  return {
    value: category,
    label: humanizeCategory(category) || 'Equipment',
    icon: '🎽',
    color: GRAY,
  };
}

/**
 * Sport options for the Add Equipment picker: General first, then every
 * enabled registry sport except 'training' (training gear fits General).
 */
export function getEquipmentSportOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'general', label: 'General / Other' },
    ...getEnabledSports()
      .filter(s => s.sport_key !== 'training')
      .map(s => ({ value: s.sport_key, label: s.display_name })),
  ];
}

/**
 * Per-sport display meta for the Equipment tab's sectioned layout. The
 * current-setup section label is sport-appropriate ("bag" makes sense for
 * golf; it wouldn't for running shoes) with a neutral default, so adding a
 * sport without an entry degrades to "Current Setup" rather than breaking.
 */
export const EQUIPMENT_SPORT_META: Record<string, { setupLabel?: string }> = {
  golf: { setupLabel: 'In the Bag' },
};

export function getSetupLabel(sportKey: string): string {
  return EQUIPMENT_SPORT_META[sportKey]?.setupLabel ?? 'Current Setup';
}
