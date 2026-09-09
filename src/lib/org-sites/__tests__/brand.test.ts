import { describe, it, expect } from 'vitest';
import { buildOrgBrand, type SiteBrandRow } from '../brand';
import { APP_SURFACE_DARK, APP_SURFACE_LIGHT, contrastRatio } from '../accent-contrast';

const SITE = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222.jpg';

function row(over: Partial<SiteBrandRow> = {}): SiteBrandRow {
  return {
    id: SITE,
    subdomain: 'eagle-creek',
    logo_path: null,
    hero_config: {},
    theme_token_set: {},
    published_at: null,
    ...over,
  };
}

describe('buildOrgBrand', () => {
  it('no site row → no brand', () => {
    expect(buildOrgBrand(null)).toBeNull();
  });

  it('a DRAFT site still yields its brand — published is just a flag (Tom, Sep 8: live by link)', () => {
    const b = buildOrgBrand(
      row({
        logo_path: `org-logos/${SITE}/1700000000-logo.png`,
        hero_config: { headline: 'Play here', tagline: 'Since 1962', imagePath: `org-media/${SITE}/${FILE}`, imageAlt: 'The first tee' },
      })
    )!;
    expect(b.published).toBe(false);
    expect(b.logoUrl).toBe(`/api/media/org-logo/${SITE}?v=1700000000-logo.png`);
    expect(b.hero).toEqual({
      imageUrl: `/api/media/org-media/${SITE}/${FILE}`,
      imageAlt: 'The first tee',
      headline: 'Play here',
      tagline: 'Since 1962',
    });
    expect(b.subdomain).toBe('eagle-creek');
    expect(buildOrgBrand(row({ published_at: '2026-09-01T00:00:00Z' }))!.published).toBe(true);
  });

  it("a hero path outside THIS site's prefix reads as no image (the URL helper re-asserts it)", () => {
    const b = buildOrgBrand(row({ hero_config: { imagePath: `org-media/33333333-3333-4333-8333-333333333333/${FILE}` } }))!;
    expect(b.hero.imageUrl).toBeNull();
    // and a malformed hero_config never throws
    expect(buildOrgBrand(row({ hero_config: 'junk' }))!.hero).toEqual({ imageUrl: null, imageAlt: '', headline: '', tagline: '' });
  });

  it('no accent tokens → accent null (the app palette stays)', () => {
    expect(buildOrgBrand(row())!.accent).toBeNull();
    expect(buildOrgBrand(row({ theme_token_set: { surface: 'tinted', typeface: 'serif' } }))!.accent).toBeNull();
    expect(buildOrgBrand(row({ theme_token_set: { accent: 'not-a-hex' } }))!.accent).toBeNull();
  });

  it('accent tokens → the fill pair plus a readable text tint per app surface', () => {
    const b = buildOrgBrand(row({ theme_token_set: { accent: '#0f766e', accentStrong: '#0b3d91' } }))!;
    expect(b.accent).toMatchObject({ fill: '#0f766e', fillStrong: '#0b3d91' });
    expect(contrastRatio(b.accent!.fgLight, APP_SURFACE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(b.accent!.fgDark, APP_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5);
    // a single accent derives its strong companion, as the public site does
    const single = buildOrgBrand(row({ theme_token_set: { accent: '#0f766e' } }))!;
    expect(single.accent!.fill).toBe('#0f766e');
    expect(single.accent!.fillStrong).not.toBe('#0f766e');
  });
});
