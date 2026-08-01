/**
 * Per-sport, per-category equipment spec fields.
 *
 * These were six hardcoded golf inputs (loft/shaft/flex/length/lie/grip)
 * inside AddEquipmentModal, rendered only when `sportKey === 'golf'`, so a
 * hockey stick could record no flex and a bat no drop. The display side never
 * needed changing: EquipmentSection already renders `specs` generically
 * (snake_case key → Title Case label), and athlete_equipment.specs is JSONB
 * with an index-signature type, so arbitrary keys already round-trip.
 *
 * ADDING SPEC FIELDS FOR A SPORT = one entry here. No component changes.
 *
 * DECLARATION ORDER IS LOAD-BEARING. Equipment cards show only the first
 * three specs and JSONB preserves insertion order, so the modal builds
 * `specs` by iterating getSpecFields() in the order below. Put the most
 * identifying spec first for each category — a stick is known by its curve,
 * a bat by its length.
 *
 * Golf's keys are byte-identical to the old hardcoded block on purpose:
 * equipment saved before this change must keep rendering with exactly the
 * same labels.
 */

import { getEquipmentCategories } from '@/lib/equipment-config';

export interface SpecFieldDef {
  /** snake_case — becomes the key in the specs JSONB object. */
  key: string;
  label: string;
  placeholder?: string;
  /** Common values offered via <datalist>. Still free text. */
  options?: string[];
  /** Restrict to these categories; absent means every category in the sport. */
  categories?: string[];
}

const GOLF_CLUBS = ['driver', 'fairway_wood', 'hybrid', 'iron_set', 'wedge', 'putter'];

export const EQUIPMENT_SPEC_FIELDS: Record<string, SpecFieldDef[]> = {
  golf: [
    { key: 'loft', label: 'Loft', placeholder: 'e.g., 10.5°', categories: GOLF_CLUBS },
    { key: 'shaft', label: 'Shaft', placeholder: 'e.g., Project X 6.0', categories: GOLF_CLUBS },
    {
      key: 'flex',
      label: 'Flex',
      options: ['Ladies', 'Senior', 'Regular', 'Stiff', 'X-Stiff'],
      categories: ['driver', 'fairway_wood', 'hybrid', 'iron_set', 'wedge'],
    },
    { key: 'length', label: 'Length', placeholder: 'e.g., 45.5"', categories: GOLF_CLUBS },
    { key: 'lie', label: 'Lie', placeholder: 'e.g., 59°', categories: ['iron_set', 'wedge', 'putter'] },
    { key: 'grip', label: 'Grip', placeholder: 'e.g., Golf Pride Tour Velvet', categories: GOLF_CLUBS },
    { key: 'compression', label: 'Compression', placeholder: 'e.g., 90', categories: ['ball'] },
    { key: 'size', label: 'Size', placeholder: 'e.g., 10.5 / M', categories: ['shoes', 'glove'] },
  ],

  ice_hockey: [
    { key: 'curve', label: 'Blade Curve', placeholder: 'e.g., P92', categories: ['stick'] },
    { key: 'flex', label: 'Flex', placeholder: 'e.g., 85', categories: ['stick'] },
    { key: 'lie', label: 'Lie', placeholder: 'e.g., 5', categories: ['stick'] },
    { key: 'hand', label: 'Hand', options: ['Left', 'Right'], categories: ['stick', 'gloves'] },
    {
      key: 'size',
      label: 'Size',
      placeholder: 'e.g., 9.5 D',
      categories: ['skates', 'helmet', 'gloves', 'pads', 'jersey'],
    },
    { key: 'holder', label: 'Holder / Steel', placeholder: 'e.g., Tuuk LS Pulse', categories: ['skates'] },
  ],

  baseball: [
    { key: 'length', label: 'Length', placeholder: 'e.g., 33"', categories: ['bat'] },
    { key: 'weight_drop', label: 'Weight Drop', placeholder: 'e.g., -3', categories: ['bat'] },
    {
      key: 'certification',
      label: 'Certification',
      options: ['BBCOR', 'USSSA', 'USA Bat', 'Wood'],
      categories: ['bat'],
    },
    { key: 'web', label: 'Web Type', options: ['I-Web', 'Trapeze', 'Basket', 'H-Web', 'Closed'], categories: ['glove'] },
    { key: 'hand', label: 'Throws', options: ['Left', 'Right'], categories: ['glove', 'batting_gloves'] },
    {
      key: 'size',
      label: 'Size',
      placeholder: 'e.g., 11.75"',
      categories: ['glove', 'cleats', 'helmet', 'batting_gloves'],
    },
  ],

  soccer: [
    {
      key: 'stud_type',
      label: 'Stud Type',
      options: ['FG', 'SG', 'AG', 'Turf', 'Indoor'],
      categories: ['cleats'],
    },
    { key: 'cut', label: 'Glove Cut', options: ['Roll', 'Flat', 'Negative', 'Hybrid'], categories: ['gloves'] },
    { key: 'ball_size', label: 'Ball Size', options: ['3', '4', '5'], categories: ['ball'] },
    {
      key: 'size',
      label: 'Size',
      placeholder: 'e.g., 9 / M',
      categories: ['cleats', 'shin_guards', 'gloves', 'apparel'],
    },
  ],

  basketball: [
    {
      key: 'ball_size',
      label: 'Ball Size',
      options: ['29.5" (Size 7)', '28.5" (Size 6)', '27.5" (Size 5)'],
      categories: ['ball'],
    },
    { key: 'size', label: 'Size', placeholder: 'e.g., 11 / M', categories: ['shoes', 'apparel'] },
    { key: 'colorway', label: 'Colorway', placeholder: 'e.g., Bred', categories: ['shoes'] },
  ],

  volleyball: [
    {
      key: 'size',
      label: 'Size',
      placeholder: 'e.g., 9 / M',
      categories: ['shoes', 'knee_pads', 'ankle_braces', 'apparel'],
    },
    { key: 'colorway', label: 'Colorway', placeholder: 'e.g., White/Navy', categories: ['shoes'] },
  ],

  // 'general' is absent on purpose — General items are free-text by nature,
  // so the modal's Specifications section simply does not render for them.
};

/**
 * Spec fields for a (sport, category) pair, in declaration order. Returns an
 * empty array — never throws — for General, unknown sports, and free-text
 * categories, mirroring getEquipmentCategories/getCategoryConfig.
 */
export function getSpecFields(sportKey: string, category: string): SpecFieldDef[] {
  return (EQUIPMENT_SPEC_FIELDS[sportKey] ?? []).filter(
    f => !f.categories || f.categories.includes(category)
  );
}

/**
 * Every category referenced by a sport's spec fields that does not exist in
 * that sport's category list. Should always be empty — a test asserts it, so
 * adding a category and forgetting its spec fields (or typo'ing one) fails
 * the build rather than silently hiding inputs.
 */
export function findUnknownSpecCategories(): Array<{ sportKey: string; key: string; category: string }> {
  const problems: Array<{ sportKey: string; key: string; category: string }> = [];
  for (const [sportKey, fields] of Object.entries(EQUIPMENT_SPEC_FIELDS)) {
    const valid = new Set(getEquipmentCategories(sportKey).map(c => c.value));
    for (const field of fields) {
      for (const category of field.categories ?? []) {
        if (!valid.has(category)) problems.push({ sportKey, key: field.key, category });
      }
    }
  }
  return problems;
}
