import { describe, expect, it } from 'vitest';
import {
  clampScheduleQuery,
  deriveStrongAccent,
  hexLuminance,
  parseHeroConfig,
  parseSponsors,
  parseThemeAccent,
  SCHEDULE_LIMIT_DEFAULT,
  SCHEDULE_LIMIT_MAX,
  SCHEDULE_RANGE_MAX_DAYS,
  SitePatchSchema,
  TOGGLEABLE_MODULE_KEYS,
} from '../validate';

describe('branding schema actions (R3)', () => {
  it('accepts set_hero with either, both, or neither field', () => {
    expect(SitePatchSchema.safeParse({ action: 'set_hero' }).success).toBe(true);
    expect(
      SitePatchSchema.safeParse({ action: 'set_hero', headline: 'Hello', tagline: 'World' })
        .success
    ).toBe(true);
  });

  it('rejects an over-long hero headline', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_hero', headline: 'x'.repeat(81) }).success
    ).toBe(false);
  });

  it('accepts a dark accent, null to clear, and rejects non-hex', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_theme', accent: '#0f766e' }).success
    ).toBe(true);
    expect(SitePatchSchema.safeParse({ action: 'set_theme', accent: null }).success).toBe(true);
    expect(SitePatchSchema.safeParse({ action: 'set_theme', accent: 'red' }).success).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_theme', accent: '#12345' }).success
    ).toBe(false);
  });

  it('rejects a near-white accent (white hero text)', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_theme', accent: '#ffff00' }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_theme', accent: '#f5f5f5' }).success
    ).toBe(false);
  });

  it('accepts sponsors with https urls only, capped at 20', () => {
    expect(
      SitePatchSchema.safeParse({
        action: 'set_sponsors',
        sponsors: [{ name: 'Acme' }, { name: 'Rinkside', url: 'https://rinkside.example' }],
      }).success
    ).toBe(true);
    expect(
      SitePatchSchema.safeParse({
        action: 'set_sponsors',
        sponsors: [{ name: 'Bad', url: 'http://insecure.example' }],
      }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({
        action: 'set_sponsors',
        sponsors: [{ name: 'Bad', url: 'javascript:alert(1)' }],
      }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({
        action: 'set_sponsors',
        sponsors: Array.from({ length: 21 }, (_, i) => ({ name: `S${i}` })),
      }).success
    ).toBe(false);
  });
});

describe('render-side parsers (never throw)', () => {
  it('parseThemeAccent: strict hex or null', () => {
    expect(parseThemeAccent({ accent: '#0F766E' })).toBe('#0f766e');
    expect(parseThemeAccent({ accent: 'red' })).toBeNull();
    expect(parseThemeAccent({ accent: 'url(x)' })).toBeNull();
    expect(parseThemeAccent(null)).toBeNull();
    expect(parseThemeAccent('nonsense')).toBeNull();
    expect(parseThemeAccent({})).toBeNull();
  });

  it('deriveStrongAccent darkens each channel', () => {
    expect(deriveStrongAccent('#ffffff')).toBe('#d9d9d9');
    expect(deriveStrongAccent('#000000')).toBe('#000000');
  });

  it('hexLuminance orders dark below light', () => {
    expect(hexLuminance('#000000')).toBe(0);
    expect(hexLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(hexLuminance('#7c3aed')).toBeLessThan(0.55);
  });

  it('parseHeroConfig tolerates garbage', () => {
    expect(parseHeroConfig({ headline: 'Hi', tagline: 'There' })).toEqual({
      headline: 'Hi',
      tagline: 'There',
    });
    expect(parseHeroConfig(null)).toEqual({ headline: '', tagline: '' });
    expect(parseHeroConfig({ headline: 42 })).toEqual({ headline: '', tagline: '' });
  });

  it('parseSponsors drops invalid rows and non-https urls', () => {
    expect(
      parseSponsors({
        sponsors: [
          { name: 'Acme', url: 'https://acme.example' },
          { name: 'NoUrl' },
          { name: 'BadUrl', url: 'http://x.example' },
          { url: 'https://nameless.example' },
          'garbage',
        ],
      })
    ).toEqual([
      { name: 'Acme', url: 'https://acme.example' },
      { name: 'NoUrl' },
      { name: 'BadUrl' },
    ]);
    expect(parseSponsors(null)).toEqual([]);
    expect(parseSponsors({ sponsors: 'nope' })).toEqual([]);
  });
});

describe('SitePatchSchema', () => {
  it('accepts publish/unpublish (the R1 shape, unchanged)', () => {
    expect(SitePatchSchema.safeParse({ action: 'publish' }).success).toBe(true);
    expect(SitePatchSchema.safeParse({ action: 'unpublish' }).success).toBe(true);
  });

  it('accepts set_module for every toggleable key', () => {
    for (const key of TOGGLEABLE_MODULE_KEYS) {
      expect(
        SitePatchSchema.safeParse({ action: 'set_module', moduleKey: key, enabled: false })
          .success
      ).toBe(true);
    }
  });

  it('rejects toggling hero — excluded at the schema level', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_module', moduleKey: 'hero', enabled: false })
        .success
    ).toBe(false);
  });

  it('rejects set_module without enabled, and unknown actions/keys', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_module', moduleKey: 'standings' }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_module', moduleKey: 'nope', enabled: true })
        .success
    ).toBe(false);
    expect(SitePatchSchema.safeParse({ action: 'delete' }).success).toBe(false);
  });
});

describe('clampScheduleQuery', () => {
  it('defaults with no input', () => {
    expect(clampScheduleQuery()).toEqual({ limit: SCHEDULE_LIMIT_DEFAULT });
    expect(clampScheduleQuery({})).toEqual({ limit: SCHEDULE_LIMIT_DEFAULT });
  });

  it('accepts in-range values (string or number)', () => {
    expect(clampScheduleQuery({ limit: 25, rangeDays: '30' })).toEqual({
      limit: 25,
      rangeDays: 30,
    });
  });

  it('clamps to the floor', () => {
    expect(clampScheduleQuery({ limit: 0, rangeDays: -5 })).toEqual({
      limit: 1,
      rangeDays: 1,
    });
  });

  it('clamps to the ceiling', () => {
    expect(clampScheduleQuery({ limit: 999, rangeDays: 9999 })).toEqual({
      limit: SCHEDULE_LIMIT_MAX,
      rangeDays: SCHEDULE_RANGE_MAX_DAYS,
    });
  });

  it('floors non-integers', () => {
    expect(clampScheduleQuery({ limit: 7.9, rangeDays: '14.5' })).toEqual({
      limit: 7,
      rangeDays: 14,
    });
  });

  it('ignores garbage (defaults, no rangeDays)', () => {
    expect(clampScheduleQuery({ limit: 'abc', rangeDays: '' })).toEqual({
      limit: SCHEDULE_LIMIT_DEFAULT,
    });
    expect(clampScheduleQuery({ limit: NaN, rangeDays: Infinity })).toEqual({
      limit: SCHEDULE_LIMIT_DEFAULT,
    });
  });
});
