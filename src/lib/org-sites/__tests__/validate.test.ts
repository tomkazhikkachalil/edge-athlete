import { describe, expect, it } from 'vitest';
import {
  clampScheduleQuery,
  deriveStrongAccent,
  hexLuminance,
  parseContact,
  parseHeroConfig,
  parseSponsors,
  parseThemeAccent,
  SCHEDULE_LIMIT_DEFAULT,
  SCHEDULE_LIMIT_MAX,
  SCHEDULE_RANGE_MAX_DAYS,
  isValidPageSlug,
  MODULE_KEYS,
  NewsCreateSchema,
  NewsPatchSchema,
  PageBodySchema,
  PagePatchSchema,
  parsePageBody,
  SitePatchSchema,
  slugifyPageTitle,
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

describe('contact + sponsor logos (cleanup round)', () => {
  const SITE = '01234567-89ab-4cde-8f01-23456789abcd';

  it('set_contact accepts the three optional fields, rejects junk', () => {
    expect(
      SitePatchSchema.safeParse({
        action: 'set_contact',
        email: 'Info@Example.COM',
        phone: '+1 613 555 0100',
        website: 'https://example.com',
      }).success
    ).toBe(true);
    expect(SitePatchSchema.safeParse({ action: 'set_contact' }).success).toBe(true);
    expect(
      SitePatchSchema.safeParse({ action: 'set_contact', email: 'not-an-email' }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_contact', website: 'http://x.example' }).success
    ).toBe(false);
  });

  it('parseContact re-validates defensively', () => {
    expect(
      parseContact({ email: 'a@b.co', phone: '613-555', website: 'https://x.example' })
    ).toEqual({ email: 'a@b.co', phone: '613-555', website: 'https://x.example' });
    expect(parseContact({ email: 'nope', phone: 'x', website: 'http://x' })).toEqual({});
    expect(parseContact(null)).toEqual({});
  });

  it('sponsor logoPath must be a site asset path; parseSponsors re-checks', () => {
    expect(
      SitePatchSchema.safeParse({
        action: 'set_sponsors',
        sponsors: [{ name: 'A', logoPath: `org-media/${SITE}/logo.png` }],
      }).success
    ).toBe(true);
    expect(
      SitePatchSchema.safeParse({
        action: 'set_sponsors',
        sponsors: [{ name: 'A', logoPath: 'covers/evil.png' }],
      }).success
    ).toBe(false);
    expect(
      parseSponsors({
        sponsors: [
          { name: 'A', logoPath: `org-media/${SITE}/logo.png` },
          { name: 'B', logoPath: '../../etc/passwd' },
        ],
      })
    ).toEqual([{ name: 'A', logoPath: `org-media/${SITE}/logo.png` }, { name: 'B' }]);
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
    // Both default gradient stops must clear the accent clamp (large-text
    // 3:1 bound) — the clamp guards the defaults' own legality.
    expect(hexLuminance('#7c3aed')).toBeLessThan(0.3);
    expect(hexLuminance('#8b5cf6')).toBeLessThan(0.3);
  });

  it('rejects mid-light accents that clear 0.3 luminance', () => {
    // A pleasant mid-tone that fails the 3:1 large-text bound.
    expect(
      SitePatchSchema.safeParse({ action: 'set_theme', accent: '#66bb88' }).success
    ).toBe(false);
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

describe('page slugs (R3)', () => {
  it('accepts normal slugs', () => {
    expect(isValidPageSlug('about-us')).toBe(true);
    expect(isValidPageSlug('a')).toBe(true);
  });

  it('rejects every module key and reserved word', () => {
    for (const key of MODULE_KEYS) expect(isValidPageSlug(key), key).toBe(false);
    for (const word of ['assets', 'site', 'admin', 'api', 'p', 'pages', 'home', 'index']) {
      expect(isValidPageSlug(word), word).toBe(false);
    }
  });

  it('rejects the metadata-route convention names (R4)', () => {
    for (const word of [
      'opengraph-image',
      'twitter-image',
      'icon',
      'apple-icon',
      'robots',
      'sitemap',
    ]) {
      expect(isValidPageSlug(word), word).toBe(false);
    }
  });

  it('rejects regex edges', () => {
    expect(isValidPageSlug('-a')).toBe(false);
    expect(isValidPageSlug('a-')).toBe(false);
    expect(isValidPageSlug('About')).toBe(false);
    expect(isValidPageSlug('a'.repeat(81))).toBe(false);
    expect(isValidPageSlug('')).toBe(false);
    expect(isValidPageSlug('a b')).toBe(false);
  });

  it('slugifyPageTitle mirrors the org pipeline without the floor', () => {
    expect(slugifyPageTitle('About Us')).toBe('about-us');
    expect(slugifyPageTitle('Fees & Dates 2026!')).toBe('fees-dates-2026');
    expect(slugifyPageTitle('X')).toBe('x');
    expect(slugifyPageTitle('!!!')).toBe('');
  });
});

describe('news schemas (phase 3.5)', () => {
  it("reserves 'news' as a page slug (module key ⇒ denylist)", () => {
    expect(isValidPageSlug('news')).toBe(false);
  });

  it('NewsCreateSchema takes a title and optional slug', () => {
    expect(NewsCreateSchema.safeParse({ title: 'Season opener' }).success).toBe(true);
    expect(NewsCreateSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('NewsPatchSchema needs at least one field; publish is a boolean', () => {
    expect(NewsPatchSchema.safeParse({}).success).toBe(false);
    expect(NewsPatchSchema.safeParse({ publish: true }).success).toBe(true);
    expect(
      NewsPatchSchema.safeParse({ body: [{ type: 'paragraph', text: 'Hi' }] }).success
    ).toBe(true);
  });
});

describe('page blocks (R3)', () => {
  const SITE = '01234567-89ab-4cde-8f01-23456789abcd';

  it('accepts each block type', () => {
    expect(PageBodySchema.safeParse([{ type: 'heading', text: 'Hi' }]).success).toBe(true);
    expect(PageBodySchema.safeParse([{ type: 'paragraph', text: 'Body' }]).success).toBe(true);
    expect(
      PageBodySchema.safeParse([
        { type: 'image', path: `org-media/${SITE}/abc123.png`, alt: 'A rink' },
      ]).success
    ).toBe(true);
    expect(
      PageBodySchema.safeParse([
        { type: 'link-list', links: [{ label: 'Fees', url: 'https://x.example/fees' }] },
      ]).success
    ).toBe(true);
  });

  it('accepts optional client-measured dimensions, rejects junk ones', () => {
    const base = { type: 'image', path: `org-media/${SITE}/a.png`, alt: 'x' };
    expect(PageBodySchema.safeParse([{ ...base, width: 800, height: 450 }]).success).toBe(true);
    expect(PageBodySchema.safeParse([base]).success).toBe(true); // legacy blocks
    expect(PageBodySchema.safeParse([{ ...base, width: 0 }]).success).toBe(false);
    expect(PageBodySchema.safeParse([{ ...base, width: 20000 }]).success).toBe(false);
    expect(PageBodySchema.safeParse([{ ...base, width: 1.5 }]).success).toBe(false);
  });

  it('rejects bad image paths (traversal, case, foreign shapes)', () => {
    for (const path of [
      `org-media/${SITE}/../secret.png`,
      `org-media/${SITE}/UPPER.PNG`,
      `org-media/not-a-uuid/a.png`,
      `covers/${SITE}/a.png`,
      `org-media/${SITE}/a.svg`,
      `org-media/${SITE}/a.png/extra`,
    ]) {
      expect(
        PageBodySchema.safeParse([{ type: 'image', path, alt: 'x' }]).success,
        path
      ).toBe(false);
    }
  });

  it('requires alt on images and https on links', () => {
    expect(
      PageBodySchema.safeParse([
        { type: 'image', path: `org-media/${SITE}/a.png`, alt: '' },
      ]).success
    ).toBe(false);
    expect(
      PageBodySchema.safeParse([
        { type: 'link-list', links: [{ label: 'x', url: 'http://x.example' }] },
      ]).success
    ).toBe(false);
  });

  it('caps the body at 40 blocks', () => {
    const blocks = Array.from({ length: 41 }, () => ({ type: 'paragraph', text: 'x' }));
    expect(PageBodySchema.safeParse(blocks).success).toBe(false);
  });

  it('parsePageBody drops malformed blocks, never throws', () => {
    expect(
      parsePageBody([
        { type: 'heading', text: 'Keep' },
        { type: 'image', path: 'covers/evil.png', alt: 'drop' },
        'garbage',
        null,
      ])
    ).toEqual([{ type: 'heading', text: 'Keep' }]);
    expect(parsePageBody('not-an-array')).toEqual([]);
    expect(parsePageBody(null)).toEqual([]);
  });

  it('PagePatchSchema rejects an empty patch', () => {
    expect(PagePatchSchema.safeParse({}).success).toBe(false);
    expect(PagePatchSchema.safeParse({ visibility: 'public' }).success).toBe(true);
  });
});

// ── Phase 6b B1: brand tokens + nav config ──────────────────────────────────
import {
  moduleLabel,
  parseNavConfig,
  parseThemeTokens,
  resolveAccentPair,
} from '../validate';

describe('parseThemeTokens', () => {
  it('re-validates every key independently and never throws', () => {
    expect(parseThemeTokens(null)).toEqual({
      accent: null,
      accentStrong: null,
      surface: 'plain',
      typeface: 'sans',
      wordmark: null,
    });
    expect(parseThemeTokens('garbage')).toMatchObject({ accent: null, typeface: 'sans' });
    const parsed = parseThemeTokens({
      accent: '#0F766E',
      accentStrong: 'javascript:alert(1)',
      surface: 'tinted',
      typeface: 'comic',
      wordmark: '  Kanata Golf  ',
    });
    expect(parsed).toEqual({
      accent: '#0f766e',
      accentStrong: null,
      surface: 'tinted',
      typeface: 'sans',
      wordmark: 'Kanata Golf',
    });
  });

  it('caps the wordmark and resolves the accent pair', () => {
    const long = parseThemeTokens({ wordmark: 'x'.repeat(80) });
    expect(long.wordmark).toHaveLength(40);
    expect(resolveAccentPair(parseThemeTokens({}))).toEqual({ accent: '#8b5cf6', strong: '#7c3aed' });
    expect(resolveAccentPair(parseThemeTokens({ accent: '#0f766e' }))).toEqual({
      accent: '#0f766e',
      strong: '#0d645e',
    });
    expect(
      resolveAccentPair(parseThemeTokens({ accent: '#0f766e', accentStrong: '#111111' })).strong
    ).toBe('#111111');
  });
});

describe('SitePatchSchema set_theme (B1 widening) + set_nav', () => {
  it('keeps the accent-only shape and accepts the full token set', () => {
    expect(SitePatchSchema.safeParse({ action: 'set_theme', accent: '#0f766e' }).success).toBe(true);
    expect(
      SitePatchSchema.safeParse({
        action: 'set_theme',
        accent: '#0f766e',
        accentStrong: '#111111',
        surface: 'tinted',
        typeface: 'serif',
        wordmark: 'KGCC',
      }).success
    ).toBe(true);
    expect(
      SitePatchSchema.safeParse({ action: 'set_theme', accent: null, accentStrong: '#ffffff' }).success
    ).toBe(false);
    expect(SitePatchSchema.safeParse({ action: 'set_theme', accent: null, typeface: 'mono' }).success).toBe(
      false
    );
  });

  it('set_nav takes toggleable keys with optional short labels', () => {
    expect(
      SitePatchSchema.safeParse({
        action: 'set_nav',
        items: [{ key: 'standings', label: 'Tables' }, { key: 'schedule' }],
      }).success
    ).toBe(true);
    expect(SitePatchSchema.safeParse({ action: 'set_nav', items: [{ key: 'hero' }] }).success).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_nav', items: [{ key: 'teams', label: 'x'.repeat(25) }] })
        .success
    ).toBe(false);
  });
});

describe('parseNavConfig / moduleLabel', () => {
  it('keeps valid keys in order, dedupes, drops junk, caps labels', () => {
    const nav = parseNavConfig([
      { key: 'schedule', label: ' Games ' },
      { key: 'standings' },
      { key: 'schedule', label: 'dupe' },
      { key: 'nope', label: 'x' },
      'garbage',
      { key: 'teams', label: 'y'.repeat(40) },
    ]);
    expect(nav.order).toEqual(['schedule', 'standings', 'teams']);
    expect(nav.labels.schedule).toBe('Games');
    expect(nav.labels.teams).toHaveLength(24);
    expect(moduleLabel('schedule', nav)).toBe('Games');
    expect(moduleLabel('standings', nav)).toBe('Standings');
    expect(parseNavConfig(null)).toEqual({ order: [], labels: {} });
  });
});

// ── Phase 6b B3: documents module ───────────────────────────────────────────
import { ORG_DOCUMENT_PATH_RE, ORG_MEDIA_FILE_RE, parseDocuments } from '../validate';

describe('documents (B3)', () => {
  const SITE = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
  const pdf = `org-media/${SITE}/abc-123.pdf`;

  it('PDFs join the org-media namespace; the document regex is PDF-only', () => {
    expect(ORG_MEDIA_FILE_RE.test('abc-123.pdf')).toBe(true);
    expect(ORG_DOCUMENT_PATH_RE.test(pdf)).toBe(true);
    expect(ORG_DOCUMENT_PATH_RE.test(`org-media/${SITE}/abc.png`)).toBe(false);
  });

  it('set_documents: file XOR link, bounded', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_documents', documents: [{ title: 'Code', path: pdf }] }).success
    ).toBe(true);
    expect(
      SitePatchSchema.safeParse({ action: 'set_documents', documents: [{ title: 'Code', url: 'https://x.org/a.pdf' }] }).success
    ).toBe(true);
    expect(
      SitePatchSchema.safeParse({ action: 'set_documents', documents: [{ title: 'Code' }] }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_documents', documents: [{ title: 'Code', path: pdf, url: 'https://x.org' }] }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_documents', documents: [{ title: 'Code', url: 'http://x.org' }] }).success
    ).toBe(false);
  });

  it('parseDocuments drops junk and prefers the stored file', () => {
    const docs = parseDocuments({
      documents: [
        { title: ' Code ', path: pdf, url: 'https://ignored.org' },
        { title: 'Policy', url: 'https://x.org/p.pdf' },
        { title: 'Bad', url: 'javascript:alert(1)' },
        { title: '', path: pdf },
        'garbage',
      ],
    });
    expect(docs).toEqual([
      { title: 'Code', path: pdf },
      { title: 'Policy', url: 'https://x.org/p.pdf' },
    ]);
    expect(parseDocuments(null)).toEqual([]);
  });
});

// ── Phase 6c G3: two pages ──────────────────────────────────────────────────
import { DEFAULT_MODULE_ORDER } from '../validate';

describe('DEFAULT_MODULE_ORDER (G3)', () => {
  it('lists every module exactly once per side, hero first, and differs by side', () => {
    for (const side of ['club', 'league'] as const) {
      const order = DEFAULT_MODULE_ORDER[side];
      expect([...order].sort()).toEqual([...MODULE_KEYS].sort());
      expect(new Set(order).size).toBe(order.length);
      expect(order[0]).toBe('hero');
    }
    expect(DEFAULT_MODULE_ORDER.club[1]).toBe('courses');
    expect(DEFAULT_MODULE_ORDER.league[1]).toBe('standings');
    expect(SitePatchSchema.safeParse({ action: 'reset_order' }).success).toBe(true);
  });

  it('moduleLabel reads the relationship from the page it is on', () => {
    const nav = parseNavConfig([]);
    expect(moduleLabel('affiliations', nav, 'club')).toBe('Leagues');
    expect(moduleLabel('affiliations', nav, 'league')).toBe('Clubs');
    expect(moduleLabel('affiliations', nav)).toBe('Affiliations');
    expect(moduleLabel('affiliations', parseNavConfig([{ key: 'affiliations', label: 'Partners' }]), 'club')).toBe('Partners');
  });
});
