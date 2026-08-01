import { describe, it, expect } from 'vitest';
import {
  canonicalKey,
  resolveAlias,
  rankSuggestions,
  getBrandSuggestions,
  getModelSuggestions,
} from '@/lib/equipment-catalog';
import { BRAND_SEEDS, getSeedBrands, getBrandPlaceholder } from '@/lib/equipment-brands';
import { FEATURE_FLAGS } from '@/lib/features';

describe('canonicalKey', () => {
  it('collapses case, punctuation and spacing', () => {
    expect(canonicalKey('G/FORE')).toBe('gfore');
    expect(canonicalKey('L.A.B. Golf')).toBe('labgolf');
    expect(canonicalKey('Under  Armour ')).toBe('underarmour');
    expect(canonicalKey('adidas')).toBe(canonicalKey('Adidas'));
  });

  it('strips accents so a diacritic is not a different brand', () => {
    expect(canonicalKey('Grüner')).toBe('gruner');
    expect(canonicalKey('Škoda')).toBe('skoda');
  });

  it('returns empty for input with nothing alphanumeric', () => {
    expect(canonicalKey('  --  ')).toBe('');
  });
});

describe('resolveAlias', () => {
  it('resolves shorthand to the canonical brand name', () => {
    expect(resolveAlias('golf', 'tm')).toBe('TaylorMade');
    expect(resolveAlias('golf', 'FJ')).toBe('FootJoy');
  });

  it('is undefined for unknown shorthand and unknown sports', () => {
    expect(resolveAlias('golf', 'zzz')).toBeUndefined();
    expect(resolveAlias('quidditch', 'tm')).toBeUndefined();
    expect(resolveAlias('golf', '')).toBeUndefined();
  });
});

describe('rankSuggestions', () => {
  const seeds = [
    { name: 'Bauer' },
    { name: 'CCM' },
    { name: 'Sher-Wood' },
    { name: 'TRUE Hockey' },
    { name: 'Warrior', aliases: ['wr'] },
  ];

  it('returns every seed for an empty query, sorted by name', () => {
    expect(rankSuggestions(seeds, [], '').map(s => s.value)).toEqual([
      'Bauer', 'CCM', 'Sher-Wood', 'TRUE Hockey', 'Warrior',
    ]);
  });

  it('ranks whole-name prefix above word-boundary prefix above substring', () => {
    const ranked = rankSuggestions(
      [{ name: 'Wood Bros' }, { name: 'Sher-Wood' }, { name: 'Driftwood' }],
      [],
      'wood'
    );
    expect(ranked.map(s => s.value)).toEqual(['Wood Bros', 'Sher-Wood', 'Driftwood']);
  });

  it('matches an alias exactly and ranks it first', () => {
    expect(rankSuggestions(seeds, [], 'wr')[0].value).toBe('Warrior');
  });

  it('excludes non-matches entirely', () => {
    expect(rankSuggestions(seeds, [], 'zzzz')).toEqual([]);
  });

  it('collapses a seed and a community entry, keeping the seed spelling', () => {
    const ranked = rankSuggestions([{ name: 'Bauer' }], [{ value: 'BAUER ', count: 9 }], '');
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ value: 'Bauer', source: 'seed', count: 9 });
  });

  it('keeps community-only entries and ranks by usage within a weight', () => {
    const ranked = rankSuggestions(
      [],
      [
        { value: 'Rare Brand', count: 2 },
        { value: 'Real Brand', count: 40 },
      ],
      'r'
    );
    expect(ranked.map(s => s.value)).toEqual(['Real Brand', 'Rare Brand']);
    expect(ranked[0].source).toBe('community');
  });

  it('respects the limit', () => {
    expect(rankSuggestions(seeds, [], '', 2)).toHaveLength(2);
    expect(rankSuggestions(seeds, [], '', 0)).toHaveLength(0);
  });

  it('carries domain and year through onto the suggestion', () => {
    const [brandHit] = rankSuggestions([{ name: 'Bauer', domain: 'bauer.com' }], [], '');
    expect(brandHit.domain).toBe('bauer.com');
    const [modelHit] = rankSuggestions([{ name: 'Qi10', year: 2024 }], [], '');
    expect(modelHit.year).toBe(2024);
  });
});

describe('getBrandSuggestions', () => {
  it('never throws for General or unknown sports — they are free text', () => {
    expect(getBrandSuggestions('general')).toEqual([]);
    expect(getBrandSuggestions('quidditch', 'nim')).toEqual([]);
  });

  it('serves every sport exposed in the equipment tab, not just golf', () => {
    // The regression this whole change exists to prevent: picking Ice Hockey
    // used to give a blank text box because the catalog was golf-only.
    for (const sportKey of FEATURE_FLAGS.FEATURE_SPORTS) {
      expect(getBrandSuggestions(sportKey).length, `${sportKey} has no brands`).toBeGreaterThan(0);
    }
  });

  it('finds the obvious brand for each sport', () => {
    expect(getBrandSuggestions('ice_hockey', 'bau')[0].value).toBe('Bauer');
    expect(getBrandSuggestions('baseball', 'rawl')[0].value).toBe('Rawlings');
    expect(getBrandSuggestions('soccer', 'umb')[0].value).toBe('Umbro');
    expect(getBrandSuggestions('volleyball', 'mika')[0].value).toBe('Mikasa');
    expect(getBrandSuggestions('basketball', 'spal')[0].value).toBe('Spalding');
  });
});

describe('golf non-regression', () => {
  // Golfers must not lose a brand they can pick today. 73 is the count carried
  // over verbatim; this fails loudly if a future tidy-up prunes the list.
  it('keeps the full golf brand list', () => {
    expect(getSeedBrands('golf').length).toBeGreaterThanOrEqual(73);
  });

  it('still offers the specific brands golfers look for', () => {
    const names = getSeedBrands('golf').map(b => b.name);
    for (const expected of [
      'Titleist', 'PING', 'Scotty Cameron', 'Sub 70', 'FootJoy', 'G/FORE', 'Other',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('keeps the "<Brand> Golf" naming that existing rows were saved with', () => {
    const names = getSeedBrands('golf').map(b => b.name);
    expect(names).toContain('Nike Golf');
    expect(names).toContain('adidas Golf');
  });

  it('still narrows models by brand and category', () => {
    const drivers = getModelSuggestions('golf', { brand: 'TaylorMade', category: 'driver' });
    expect(drivers.map(m => m.value)).toContain('Stealth 2');
    expect(drivers.map(m => m.value)).not.toContain('Pro V1'); // Titleist ball
  });

  it('falls back to the category when the brand is free text we do not know', () => {
    const models = getModelSuggestions('golf', { brand: 'Some Custom Builder', category: 'putter' });
    expect(models.length).toBeGreaterThan(0);
  });

  it('has no models for the other sports, by design', () => {
    expect(getModelSuggestions('ice_hockey', { query: 'a' })).toEqual([]);
  });
});

describe('brand seed hygiene', () => {
  it('has unique ids within each sport', () => {
    for (const [sportKey, brands] of Object.entries(BRAND_SEEDS)) {
      const ids = brands.map(b => b.id);
      expect(new Set(ids).size, `${sportKey} has duplicate ids`).toBe(ids.length);
    }
  });

  it('has no duplicate display names within a sport', () => {
    for (const [sportKey, brands] of Object.entries(BRAND_SEEDS)) {
      const keys = brands.map(b => canonicalKey(b.name));
      expect(new Set(keys).size, `${sportKey} has duplicate names`).toBe(keys.length);
    }
  });

  it('uses bare domains, never URLs — BrandLogo interpolates them into a path', () => {
    for (const brands of Object.values(BRAND_SEEDS)) {
      for (const brand of brands) {
        if (!brand.domain) continue;
        expect(brand.domain, `${brand.name} domain`).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      }
    }
  });

  it('gives every sport a usable placeholder', () => {
    expect(getBrandPlaceholder('ice_hockey')).toContain('Bauer');
    expect(getBrandPlaceholder('general')).toContain('Nike');
  });
});
