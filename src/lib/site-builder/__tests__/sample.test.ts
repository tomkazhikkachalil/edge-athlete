import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { ORG_MEDIA_PATH_RE, parseContact, parseDocuments, parseHeroConfig, parsePageBody, parseSponsors } from '@/lib/org-sites/validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { FIXTURE_RULES, LEADERBOARD_RULES } from '@/lib/competitions/scoring';
import { SITE_WIDGET_KEYS, type SiteWidgetKey } from '../catalog';
import { isWidgetEmpty } from '../emptiness';
import { place } from '../seeds';
import {
  SAMPLE_MEDIA_URI_RE,
  SAMPLE_SENTINEL,
  SAMPLE_SPONSORS,
  applySample,
  coverSvg,
  logoSvg,
  sampleContentFor,
  sampleHomeData,
  sampleInstance,
  sampleKeysFor,
  type SampleSite,
} from '../sample';

// Program 3 S1 — the editor's sample data. The pins that keep the house
// rule true by construction: pure, injected emptiness, a clone (never a
// mutation), sample media that no write path admits, and a sentinel the
// e2e can assert ABSENT from the draft PUT and the published page.

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-13T15:00:00.000Z');

const EMPTY: SiteHomeData = {
  standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [], leaders: [],
  clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
};

type TestSite = SampleSite & { visibility: 'public' | 'private'; template_id: string; hero_config: Record<string, unknown>; contact_config: Record<string, unknown> };

const rows = (keys: readonly string[]) => keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} as Record<string, unknown> }));
const blankSite = (over: Partial<TestSite> = {}): TestSite => ({
  orgName: 'Harbour Golf League',
  sportKey: 'golf',
  side: 'league',
  modules: rows(SITE_WIDGET_KEYS.filter(k => k !== 'text' && k !== 'image' && k !== 'embed' && k !== 'contact_form' && k !== 'interest_form')),
  hero_config: {},
  contact_config: {},
  visibility: 'public',
  template_id: 'classic',
  ...over,
});
const fullLayout = () => ({ version: 1 as const, cols: 12 as const, widgets: SITE_WIDGET_KEYS.map((k, i) => place(k, 0, i * 4, undefined, { id: `w-${k}` })) });
const isEmpty = (w: Parameters<typeof isWidgetEmpty>[0], d: SiteHomeData, s: TestSite) => isWidgetEmpty(w, d, s);

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}
const dataUris = (v: unknown): string[] => (JSON.stringify(v).match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g) ?? []);

describe('applySample — which instances render sample content', () => {
  it('on a blank site every widget but the two forms and the gallery is sampled, and the sampled clone is not empty while the real instance is', () => {
    const site = blankSite();
    const layout = fullLayout();
    const view = applySample(site, EMPTY, layout, true, isEmpty, NOW);
    const skipped: SiteWidgetKey[] = ['contact_form', 'interest_form', 'gallery'];
    for (const w of layout.widgets) {
      const key = w.key as SiteWidgetKey;
      if (skipped.includes(key)) {
        expect(view.sampled.has(w.id), key).toBe(false);
        continue;
      }
      expect(view.sampled.has(w.id), key).toBe(true);
      if (key === 'hero') continue; // the hero is never "empty" — sampled on a blank hero_config instead
      if (key === 'embed') continue; // no content sample: the canvas draws its own placeholder frame (S2)
      expect(isWidgetEmpty(w, EMPTY, site), `${key} real`).toBe(true);
      const clone = sampleInstance(w, view.sampled, { orgName: site.orgName, sportKey: site.sportKey });
      expect(isWidgetEmpty(clone, view.sampleData, view.site), `${key} sampled`).toBe(false);
    }
  });

  it('a widget with real content is untouched: not sampled, its module row the same object', () => {
    const site = blankSite();
    const sponsorsRow = site.modules.find(m => m.module_key === 'sponsors')!;
    sponsorsRow.config = { sponsors: [{ name: 'Real Sponsor Ltd' }] };
    const layout = fullLayout();
    const view = applySample(site, EMPTY, layout, true, isEmpty, NOW);
    expect(view.sampled.has('w-sponsors')).toBe(false);
    expect(view.site.modules.find(m => m.module_key === 'sponsors')).toBe(sponsorsRow);
    expect(view.site).not.toBe(site); // others were sampled → a clone
    expect(parseSponsors(view.site.modules.find(m => m.module_key === 'sponsors')!.config).map(s => s.name)).toEqual(['Real Sponsor Ltd']);
  });

  it('a standings tile bound to a real competition with rows keeps the real bag; its empty sibling renders the sample one through a query-less clone', () => {
    const site = blankSite();
    const real: SiteHomeData = {
      ...EMPTY,
      standings: {
        orgName: site.orgName,
        competitions: [{ id: 'comp-real', name: 'Real Cup', season_label: null, format: 'fixtures', status: 'active', columns: FIXTURE_RULES.points_3_1_0.columns, rows: [{ rank: 1, entrant_name: 'A', played: 1, points: 3, stats: {} }], disputedCount: 0, direction: 'desc', entrant_type: 'team', sport_key: 'soccer' }],
      },
    };
    const bound = place('standings', 0, 0, undefined, { id: 'bound', config: { query: { competitionId: 'comp-real' } } });
    const other = place('standings', 0, 4, undefined, { id: 'other', config: { query: { competitionId: 'comp-gone' } } });
    const view = applySample(site, real, { version: 1, cols: 12, widgets: [bound, other] }, true, isEmpty, NOW);
    expect(view.sampled.has('bound')).toBe(false);
    expect(view.sampled.has('other')).toBe(true);
    expect(sampleInstance(bound, view.sampled, { orgName: '' })).toBe(bound);
    const clone = sampleInstance(other, view.sampled, { orgName: '' });
    expect((clone.config as Record<string, unknown>).query).toBeUndefined();
    expect(isWidgetEmpty(clone, view.sampleData, view.site)).toBe(false);
    expect(view.site).toBe(site); // no content key sampled → the same reference
  });

  it('never mutates its inputs; disabled or nothing-empty returns the same site reference and an empty set', () => {
    const site = deepFreeze(blankSite());
    const layout = deepFreeze(fullLayout());
    const data = deepFreeze({ ...EMPTY });
    const on = applySample(site, data, layout, true, isEmpty, NOW);
    expect(on.sampled.size).toBeGreaterThan(0);
    expect(on.site).not.toBe(site);
    const off = applySample(site, data, layout, false, isEmpty, NOW);
    expect(off.site).toBe(site);
    expect(off.sampled.size).toBe(0);
    const nothing = applySample(site, data, { version: 1, cols: 12, widgets: [] }, true, isEmpty, NOW);
    expect(nothing.site).toBe(site);
    expect(nothing.sampled.size).toBe(0);
  });

  it('the hero is sampled only on a blank hero_config (a headline OR a photo is real content)', () => {
    const layout = { version: 1 as const, cols: 12 as const, widgets: [place('hero', 0, 0, undefined, { id: 'h' })] };
    expect(applySample(blankSite(), EMPTY, layout, true, isEmpty, NOW).sampled.has('h')).toBe(true);
    expect(applySample(blankSite({ hero_config: { headline: 'Real words' } }), EMPTY, layout, true, isEmpty, NOW).sampled.has('h')).toBe(false);
    expect(applySample(blankSite({ hero_config: { imagePath: `org-media/${SITE_ID}/hero.jpg` } }), EMPTY, layout, true, isEmpty, NOW).sampled.has('h')).toBe(false);
    const view = applySample(blankSite(), EMPTY, layout, true, isEmpty, NOW);
    const hero = parseHeroConfig(view.site.hero_config);
    expect(hero.headline).toContain('Harbour Golf League');
    expect(hero.imagePath).toMatch(SAMPLE_MEDIA_URI_RE);
  });
});

describe('sampleHomeData — volumes and sport awareness', () => {
  it('a golf league: 8 points-race rows on the golf points columns, an open week, one round, a net board, 4 events, 3 posts', () => {
    const d = sampleHomeData('golf', 'league', NOW);
    const c = d.standings!.competitions[0];
    expect(c.rows).toHaveLength(8);
    expect(c.columns).toBe(LEADERBOARD_RULES.golf_points.columns);
    expect(c.entrant_type).toBe('athlete');
    expect(c.golf?.weeks[0].state).toBe('open');
    expect(c.golf?.currentWeekId).toBe(c.golf?.weeks[0].id);
    expect(c.rows.map(r => r.points)).toEqual([...c.rows.map(r => r.points)].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(d.golfRounds).toHaveLength(1);
    expect(d.leaders).toHaveLength(1);
    expect(d.leaders[0].stats[0].rows).toHaveLength(5);
    expect(d.events).toHaveLength(4);
    expect(d.news).toHaveLength(3);
    expect(d.staff).toHaveLength(3);
    expect(d.venues).toHaveLength(1);
    expect(d.affiliations).toHaveLength(2);
    expect(d.openWindows).toHaveLength(1);
    expect(d.courses).toHaveLength(1);
    expect(d.courses[0].course.holes).toHaveLength(18);
    expect(d.courses[0].course.holes.reduce((s, h) => s + h.par, 0)).toBe(72);
    expect(d.courseStrip?.roundsPosted).toBe(42);
    expect(d.memberStats?.members).toHaveLength(8);
    expect(d.divisions).toHaveLength(2);
    expect(d.teams).toHaveLength(4);
  });

  it('a team sport: 8 fixture rows whose points follow the rule (hockey 2-1-0, the rest 3-1-0), team entrants, no golf keys', () => {
    for (const [sport, rule] of [['ice_hockey', FIXTURE_RULES.points_2_1_0], ['soccer', FIXTURE_RULES.points_3_1_0], [null, FIXTURE_RULES.points_3_1_0]] as const) {
      const d = sampleHomeData(sport, 'club', NOW);
      const c = d.standings!.competitions[0];
      expect(c.columns, String(sport)).toBe(rule.columns);
      expect(c.entrant_type).toBe('team');
      expect(c.rows).toHaveLength(8);
      for (const r of c.rows) {
        expect(r.points).toBe(r.stats.w * rule.win + r.stats.t * rule.tie + r.stats.l * rule.loss);
        expect(r.played).toBe(r.stats.w + r.stats.l + r.stats.t);
        expect(r.stats.diff).toBe(r.stats.gf - r.stats.ga);
      }
      expect(d.golfRounds).toEqual([]);
      expect(d.courses).toEqual([]);
      expect(d.memberStats).toBeNull();
      expect(d.courseStrip).toBeNull();
      expect(d.leaders[0].unsupported).toBe(false);
      expect(d.leaders[0].stats).toHaveLength(2);
    }
    expect(sampleHomeData('ice_hockey', 'club', NOW).venues[0].facilities[0].kind).toBe('rink');
    expect(sampleHomeData('basketball', 'club', NOW).venues[0].facilities[0].kind).toBe('court');
    expect(sampleHomeData('ice_hockey', 'club', NOW).leaders[0].stats.map(s => s.label)).toEqual(['Goals', 'Assists']);
  });

  it('dates are relative to now: events ahead, posts behind, the registration window open today', () => {
    const d = sampleHomeData('soccer', 'league', NOW);
    for (const e of d.events!) expect(new Date(e.starts_at).getTime()).toBeGreaterThan(NOW.getTime());
    for (const p of d.news!) expect(new Date(p.publishedAt).getTime()).toBeLessThan(NOW.getTime());
    const w = d.openWindows[0];
    expect(new Date(w.opensAt).getTime()).toBeLessThan(NOW.getTime());
    expect(new Date(w.closesAt!).getTime()).toBeGreaterThan(NOW.getTime());
    const g = sampleHomeData('golf', 'league', NOW).standings!.competitions[0].golf!.weeks[0];
    expect(g.playFrom <= NOW.toISOString().slice(0, 10) && g.playTo >= NOW.toISOString().slice(0, 10)).toBe(true);
  });

  it('every data key a widget reads is present in the bag (no widget samples to an empty slice)', () => {
    const d = sampleHomeData('golf', 'league', NOW);
    for (const key of SITE_WIDGET_KEYS) {
      for (const k of sampleKeysFor(key)) {
        const v = d[k];
        if (k === 'clubGolfBoards') continue; // deliberately empty — courses read the course list instead
        expect(v == null || (Array.isArray(v) && v.length === 0), `${key}.${k}`).toBe(false);
      }
    }
  });

  it('nobody links: no handle on any sampled person, and names are in the masked shape', () => {
    const d = sampleHomeData('golf', 'club', NOW);
    const masked = /^[A-Z][a-z]+ [A-Z]\.$/;
    for (const r of d.standings!.competitions[0].rows) {
      expect(r.playerHandle).toBeUndefined();
      expect(r.entrant_name).toMatch(masked);
    }
    for (const s of d.staff) expect(s.name).toMatch(masked);
    for (const m of d.memberStats!.members) {
      expect(m.handle).toBeNull();
      expect(m.name).toMatch(masked);
    }
    for (const b of d.leaders) for (const s of b.stats) for (const r of s.rows) expect(r.playerHandle).toBeUndefined();
  });
});

describe('sampleContentFor — the config-backed widgets parse with the render parsers', () => {
  const ctx = { orgName: 'Harbour Golf League', sportKey: 'golf' };

  it('six sponsors with six logos and a tier each', () => {
    const parsed = parseSponsors(sampleContentFor('sponsors', ctx));
    expect(parsed).toHaveLength(6);
    expect(parsed.filter(s => s.logoPath).length).toBe(6);
    expect(SAMPLE_SPONSORS.map(s => s.tier)).toEqual(['platinum', 'gold', 'gold', 'silver', 'bronze', 'partner']);
    expect(parsed.some(s => s.url)).toBe(false); // nothing to click
  });

  it('a full contact block, two documents, one paragraph, a photo, a hero with a photo', () => {
    expect(Object.keys(parseContact(sampleContentFor('contact', ctx))).length).toBeGreaterThanOrEqual(5);
    expect(parseContact(sampleContentFor('contact', ctx)).social?.instagram).toBeDefined();
    expect(parseDocuments(sampleContentFor('documents', ctx))).toHaveLength(2);
    expect(parsePageBody(sampleContentFor('text', ctx).blocks)).toHaveLength(1);
    expect(sampleContentFor('image', ctx).path).toMatch(SAMPLE_MEDIA_URI_RE);
    expect(parseHeroConfig(sampleContentFor('hero', ctx)).imagePath).toMatch(SAMPLE_MEDIA_URI_RE);
    expect(sampleContentFor('embed', ctx)).toEqual({});
    expect(sampleContentFor('standings', ctx)).toEqual({});
  });

  it('sampleInstance lays the content sample on a content widget and strips the query; an unsampled one is the same object', () => {
    const w = place('text', 0, 0, undefined, { id: 't', config: { title: 'Keep me', query: { limit: 3 } } });
    const clone = sampleInstance(w, new Set(['t']), ctx);
    expect(clone).not.toBe(w);
    expect(clone.config).toMatchObject({ title: 'Keep me' });
    expect((clone.config as Record<string, unknown>).query).toBeUndefined();
    expect(parsePageBody((clone.config as Record<string, unknown>).blocks)).toHaveLength(1);
    expect(sampleInstance(w, new Set(), ctx)).toBe(w);
  });
});

describe('sample media — render pass-through, never a stored shape', () => {
  it('every sample image is a base64 SVG data URI that orgMediaUrl returns unchanged and the stored-path regex rejects', () => {
    const uris = [
      ...dataUris(sampleHomeData('golf', 'league', NOW)),
      ...dataUris(sampleContentFor('sponsors', { orgName: 'x' })),
      ...dataUris(sampleContentFor('hero', { orgName: 'x' })),
      ...dataUris(sampleContentFor('image', { orgName: 'x' })),
      logoSvg('Ab', 10),
      coverSvg(200, 'team'),
    ];
    expect(uris.length).toBeGreaterThan(8);
    for (const u of uris) {
      expect(u).toMatch(SAMPLE_MEDIA_URI_RE);
      expect(orgMediaUrl(SITE_ID, u)).toBe(u);
      expect(ORG_MEDIA_PATH_RE.test(u)).toBe(false);
    }
    // The real rule is untouched: a stored path streams, a foreign one is null.
    expect(orgMediaUrl(SITE_ID, `org-media/${SITE_ID}/a.jpg`)).toBe(`/api/media/org-media/${SITE_ID}/a.jpg`);
    expect(orgMediaUrl(SITE_ID, 'org-media/other/a.jpg')).toBeNull();
    expect(orgMediaUrl(SITE_ID, 'data:image/png;base64,AAAA')).toBeNull();
    expect(orgMediaUrl(SITE_ID, 'data:image/svg+xml;utf8,<svg/>')).toBeNull();
  });

  it('logos carry the initials, covers a sport glyph — decodable SVG', () => {
    const svg = Buffer.from(logoSvg('Meadowvale Hardware', 24).split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('>ME<');
    expect(Buffer.from(coverSvg(120, 'golf').split(',')[1], 'base64').toString('utf8')).toContain('<svg');
  });
});

describe('the sentinel and the brand rule', () => {
  it('every family carries the sentinel; no sample string names a real brand', () => {
    const denylist = /nike|adidas|titleist|callaway|taylormade|tim hortons|canadian tire|coca|pepsi|gatorade|rbc|scotiabank|td bank|bauer|ccm/i;
    for (const sport of ['golf', 'ice_hockey', 'soccer', null] as const) {
      for (const side of ['league', 'club'] as const) {
        const json = JSON.stringify(sampleHomeData(sport, side, NOW));
        expect(json).toContain(SAMPLE_SENTINEL);
        expect(json).not.toMatch(denylist);
      }
    }
    for (const key of ['sponsors', 'documents', 'contact', 'hero', 'text'] as const) {
      const json = JSON.stringify(sampleContentFor(key, { orgName: 'Org', sportKey: 'golf' }));
      expect(json, key).toContain(SAMPLE_SENTINEL);
      expect(json).not.toMatch(denylist);
    }
  });
});
