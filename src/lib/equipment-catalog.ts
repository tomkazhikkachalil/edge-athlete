/**
 * Equipment brand/model suggestions — matching, merging and ranking.
 *
 * Sport-agnostic by construction. The previous version of this file was the
 * opposite: a `getCatalogService(sport)` switch with a golf case and an
 * `async () => []` default, and that default branch was dead code, because
 * AddEquipmentModal early-returned on `sportKey !== 'golf'` before ever
 * calling it. Picking Ice Hockey therefore gave you two blank text boxes.
 *
 * The variation point that actually matters is the SOURCE of a suggestion,
 * not the sport:
 *   - seed       curated per sport in equipment-brands.ts
 *   - community  what other athletes have already entered (not built yet)
 *
 * So the merge takes community entries as an ARGUMENT rather than hiding a
 * fetch behind a service interface. When the community endpoint lands, the
 * caller fetches and passes them in and nothing here changes shape. No
 * placeholder abstraction is exported before it has an implementation —
 * shipping one is the mistake this file is recovering from.
 *
 * Everything here is pure and synchronous, which is what makes it testable
 * in this repo's node-only setup (there is no jsdom). It also means the
 * dropdown paints on the first keystroke — the old code awaited a fake
 * `setTimeout(100)` that imitated an API call it never made.
 */

import {
  getSeedBrands,
  getSeedModels,
  type EquipmentBrand,
  type EquipmentModel,
} from '@/lib/equipment-brands';

export type { EquipmentBrand, EquipmentModel };

/** One row in a brand or model dropdown. Brands and models share the shape. */
export interface EquipmentSuggestion {
  /** Display text — exactly what lands in the input when picked. */
  value: string;
  /** Where it came from. Seeds win over community on a name collision. */
  source: 'seed' | 'community';
  /** Community only: how many athletes use it. Drives ranking. */
  count?: number;
  /** Brands only: the brand's own domain, for logo lookup. */
  domain?: string;
  /** Models only. */
  year?: number;
}

/** A brand or model string other athletes have entered, with its frequency. */
export interface CommunityEntry {
  value: string;
  count: number;
}

/** Default dropdown size. Generous: an empty query means "browse them all" —
 *  and it must exceed the largest seed list (golf: 73 brands), or browse-all
 *  silently truncates. */
const DEFAULT_LIMIT = 100;

/**
 * Comparison key for a brand or model name. Collapses the ways the same brand
 * gets typed — case, spacing, punctuation, accents:
 *
 *   'G/FORE'        → 'gfore'
 *   'L.A.B. Golf'   → 'labgolf'
 *   'Under  Armour' → 'underarmour'
 *   'Grüner'        → 'gruner'
 */
export function canonicalKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip combining accents left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Split on anything that isn't a letter or digit, for word-prefix matching. */
function words(name: string): string[] {
  return name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Resolve a typed shorthand to a seed brand's display name — 'tm' →
 * 'TaylorMade', 'ua' → 'Under Armour'. Undefined when nothing matches.
 */
export function resolveAlias(sportKey: string, typed: string): string | undefined {
  const key = canonicalKey(typed);
  if (!key) return undefined;
  const hit = getSeedBrands(sportKey).find(b =>
    (b.aliases ?? []).some(a => canonicalKey(a) === key)
  );
  return hit?.name;
}

/** Lower is better. Null means the candidate does not match at all. */
function matchWeight(name: string, aliases: string[] | undefined, query: string): number | null {
  if (!query) return 0; // empty query → everything matches equally
  const key = canonicalKey(name);
  if (key.startsWith(query)) return 0;
  if (aliases?.some(a => canonicalKey(a) === query)) return 0;
  if (words(name).some(w => canonicalKey(w).startsWith(query))) return 1;
  if (key.includes(query)) return 2;
  return null;
}

interface SeedLike {
  name: string;
  domain?: string;
  year?: number;
  aliases?: string[];
}

/**
 * Merge curated seeds with community entries and rank them against a query.
 *
 * Order: match quality (whole-name prefix or alias, then word-boundary
 * prefix, then substring), then community usage, then name.
 *
 * A seed and a community entry sharing a canonical key collapse into ONE
 * suggestion — the seed supplies the display spelling, so `TITLEIST ` as
 * typed by one athlete never overrides the canonical casing, while the
 * community supplies the usage count that lifts it up the list.
 */
export function rankSuggestions(
  seeds: readonly SeedLike[],
  community: readonly CommunityEntry[],
  query: string,
  limit: number = DEFAULT_LIMIT
): EquipmentSuggestion[] {
  const q = canonicalKey(query);
  const byKey = new Map<string, { weight: number; suggestion: EquipmentSuggestion }>();

  for (const seed of seeds) {
    const weight = matchWeight(seed.name, seed.aliases, q);
    if (weight === null) continue;
    const key = canonicalKey(seed.name);
    if (!key || byKey.has(key)) continue; // first declaration wins
    byKey.set(key, {
      weight,
      suggestion: {
        value: seed.name,
        source: 'seed',
        ...(seed.domain ? { domain: seed.domain } : {}),
        ...(seed.year ? { year: seed.year } : {}),
      },
    });
  }

  for (const entry of community) {
    const key = canonicalKey(entry.value);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      // Seed keeps the display name; community contributes the count only.
      existing.suggestion.count = entry.count;
      continue;
    }
    const weight = matchWeight(entry.value, undefined, q);
    if (weight === null) continue;
    byKey.set(key, {
      weight,
      suggestion: { value: entry.value, source: 'community', count: entry.count },
    });
  }

  return [...byKey.values()]
    .sort(
      (a, b) =>
        a.weight - b.weight ||
        (b.suggestion.count ?? 0) - (a.suggestion.count ?? 0) ||
        a.suggestion.value.localeCompare(b.suggestion.value)
    )
    .slice(0, Math.max(0, limit))
    .map(e => e.suggestion);
}

/**
 * Brand suggestions for a sport. Empty for 'general' and unknown sports,
 * which fall back to plain free text — as does every sport, always. The
 * dropdown suggests; it never constrains.
 */
export function getBrandSuggestions(
  sportKey: string,
  query: string = '',
  opts: { limit?: number; community?: readonly CommunityEntry[] } = {}
): EquipmentSuggestion[] {
  return rankSuggestions(getSeedBrands(sportKey), opts.community ?? [], query, opts.limit);
}

/**
 * Model suggestions, narrowed by the brand and category already chosen.
 *
 * `brand` arrives as the typed display name, which may be free text in no
 * seed list at all — the brand filter is then skipped rather than returning
 * nothing, so an unrecognised brand still shows the category's models.
 */
export function getModelSuggestions(
  sportKey: string,
  params: { brand?: string; category?: string; query?: string } = {},
  opts: { limit?: number; community?: readonly CommunityEntry[] } = {}
): EquipmentSuggestion[] {
  let seeds: EquipmentModel[] = getSeedModels(sportKey);

  if (params.brand) {
    const brandKey = canonicalKey(params.brand);
    const seedBrand: EquipmentBrand | undefined = getSeedBrands(sportKey).find(
      b => canonicalKey(b.name) === brandKey
    );
    if (seedBrand) seeds = seeds.filter(m => m.brand === seedBrand.id);
  }
  if (params.category) {
    seeds = seeds.filter(m => m.category === params.category);
  }

  return rankSuggestions(seeds, opts.community ?? [], params.query ?? '', opts.limit);
}
