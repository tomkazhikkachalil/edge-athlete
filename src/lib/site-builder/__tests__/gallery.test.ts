import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, THEME_DENSITIES, THEME_HEADERS, THEME_HEROES, THEME_TEAMS, THEME_TYPEFACES } from '@/lib/org-sites/validate';
import { MEMBERS_ONLY_MODULE_KEYS } from '@/lib/org-sites/private';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { GALLERY_ENTRY_IDS } from '../gallery-ids';
import {
  GALLERY_ENTRIES,
  MAP_ID,
  NEUTRAL_ORG,
  WELCOME_ID,
  applyGallerySeed,
  clip,
  galleryEntriesFor,
  galleryEntry,
  galleryMap,
  gallerySeed,
  galleryWelcome,
  type GalleryOrg,
} from '../gallery';
import { isWidgetEmpty } from '../emptiness';
import { isContentWidgetKey } from '../catalog';
import { compactLayout, validateLayout, type SiteLayout, type WidgetInstance } from '../layout';
import { LAYOUT_WIDGETS_MAX } from '../layout-schema';
import { instanceSchemaFor } from '../schemas';
import { parseEmbed } from '../embeds';
import { seedLayout } from '../seeds';

// Phase 11: a gallery entry is family + design tokens + a seed plan; its
// seed is computed for THIS org (enabled modules, real words, a real map) and
// laid over the draft without ever creating a module instance the org lacks.

const EMPTY_DATA: SiteHomeData = {
  standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [], leaders: [],
  clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
};
const rows = (keys: readonly string[]) => keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} }));
const shape = (keys: readonly string[], visibility: 'public' | 'private' = 'public', template_id = 'classic') => ({
  modules: rows(keys),
  hero_config: {},
  contact_config: {},
  visibility,
  template_id,
});
const ALL = MODULE_KEYS;
const FEW = ['hero', 'schedule', 'contact'];
const ORG: GalleryOrg = { orgName: 'Kanata Golf Club', city: 'Kanata', region: 'ON', venues: [{ id: 'v1', name: 'Loch March', lat: 45.3, lng: -75.9 }] };
const NO_COORDS: GalleryOrg = { ...ORG, venues: [{ id: 'v1', name: 'Loch March', lat: null, lng: null }] };
const NO_VENUE: GalleryOrg = { ...ORG, venues: [] };
const SIDES = ['league', 'club'] as const;
const SPORTS = ['golf', 'ice_hockey', null] as const;
// Compaction is idempotent in GEOMETRY; the output order follows the input positions, so compare by id.
const byId = (ws: readonly WidgetInstance[]) => [...ws].sort((a, b) => a.id.localeCompare(b.id));
const ORGS = { ORG, NO_COORDS, NO_VENUE, NEUTRAL: NEUTRAL_ORG('club') };

describe('the gallery — entries', () => {
  it('ids match the zero-import list; every entry is inside the enums; ≥3 entries per side × sport', () => {
    expect(GALLERY_ENTRIES.map(e => e.id)).toEqual([...GALLERY_ENTRY_IDS]);
    for (const e of GALLERY_ENTRIES) {
      expect(['classic', 'bold'], e.id).toContain(e.family);
      expect(e.name.length, e.id).toBeGreaterThan(0);
      expect(e.blurb.length, e.id).toBeLessThanOrEqual(120);
      if (e.tokens.typeface) expect(THEME_TYPEFACES, e.id).toContain(e.tokens.typeface);
      if (e.tokens.header) expect(THEME_HEADERS, e.id).toContain(e.tokens.header);
      if (e.tokens.hero) expect(THEME_HEROES, e.id).toContain(e.tokens.hero);
      if (e.tokens.density) expect(THEME_DENSITIES, e.id).toContain(e.tokens.density);
      if (e.tokens.teams) expect(THEME_TEAMS, e.id).toContain(e.tokens.teams);
      for (const s of e.slots) {
        expect([6, 12], e.id).toContain(s.w);
        if ('module' in s) expect(ALL as readonly string[], `${e.id}:${s.module}`).toContain(s.module);
      }
      // members (a roster count) is a golf-club idea; a team org's page never seeds it.
      if (!e.forSports.includes('golf') || e.forSports.includes('team')) {
        if (e.forSports.includes('team')) expect(e.slots.some(s => 'module' in s && s.module === 'members'), e.id).toBe(false);
      }
    }
    for (const side of SIDES) {
      for (const sport of SPORTS) {
        const list = galleryEntriesFor(side, sport);
        expect(list.length, `${side}/${sport}`).toBeGreaterThanOrEqual(3);
        expect(list.map(e => e.id), `${side}/${sport}`).toContain('simple');
      }
    }
    expect(galleryEntry('golf-tour')?.family).toBe('bold');
    expect(galleryEntry('nope')).toBeNull();
  });

  it('members-only mirror equals private.ts (the seed marks a private club’s new instances honestly)', () => {
    const l = gallerySeed(galleryEntry('golf-clubhouse')!, shape(ALL, 'private'), ORG, 'club', 'golf');
    for (const w of l.widgets) {
      if (isContentWidgetKey(w.key) || w.key === 'hero') continue;
      const expected = (MEMBERS_ONLY_MODULE_KEYS as readonly string[]).includes(w.key) ? 'members' : 'public';
      expect(w.visibility, w.key).toBe(expected);
    }
    const pub = gallerySeed(galleryEntry('golf-clubhouse')!, shape(ALL, 'public'), ORG, 'club', 'golf');
    expect(pub.widgets.every(w => w.visibility === 'public')).toBe(true);
  });
});

describe('the gallery — generated content', () => {
  it('welcome: the real name, side × sport copy with the place; long names clipped to the caps', () => {
    const golf = galleryWelcome(ORG, 'club', 'golf');
    expect(golf.heading).toBe('Welcome to Kanata Golf Club');
    expect(golf.paragraph).toContain('Kanata, ON');
    expect(galleryWelcome(ORG, 'league', 'ice_hockey').paragraph).toContain('ice hockey');
    expect(galleryWelcome({ ...ORG, city: null, region: null }, 'league', null).paragraph.length).toBeGreaterThan(20);
    expect(galleryWelcome(NEUTRAL_ORG('league'), 'league', null).heading).toBe('Welcome to our league');
    const long = galleryWelcome({ ...ORG, orgName: 'X'.repeat(300) }, 'club', 'golf');
    expect(long.heading.length).toBeLessThanOrEqual(120);
    expect(long.paragraph.length).toBeLessThanOrEqual(600);
    expect(clip('abc', 5)).toBe('abc');
    expect(clip('abcdefgh', 5)).toHaveLength(5);
    expect(clip('abcdefgh', 5).endsWith('…')).toBe(true);
  });

  it('map: only with finite in-range coordinates on the FIRST venue; the embed round-trips the parser', () => {
    const m = galleryMap(ORG)!;
    expect(m.title).toBe('Where we play');
    expect(m.venueName).toBe('Loch March');
    expect(m.embed).toMatchObject({ provider: 'osm', marker: [45.3, -75.9] });
    expect(parseEmbed(m.embed)).toEqual(m.embed);
    expect(galleryMap(NO_COORDS)).toBeNull();
    expect(galleryMap(NO_VENUE)).toBeNull();
    expect(galleryMap({ ...ORG, venues: [{ id: 'v', name: 'Bad', lat: 91, lng: 0 }] })).toBeNull();
    expect(galleryMap({ ...ORG, venues: [{ id: 'v', name: 'Bad', lat: Number.NaN, lng: 0 }] })).toBeNull();
    // The first venue WITH coordinates decides — one without them is skipped.
    expect(galleryMap({ ...ORG, venues: [{ id: 'v0', name: 'No pin', lat: null, lng: null }, ORG.venues[0]] })?.venueName).toBe('Loch March');
  });
});

describe('gallerySeed — every entry × side × sport × org × module set', () => {
  const site = { modules: [], hero_config: {}, contact_config: {}, visibility: 'public' as const };
  it('is a valid, compact layout: hero first, unique ids, under the cap, content non-empty at render, no map without coords', () => {
    for (const e of GALLERY_ENTRIES) {
      for (const side of SIDES) {
        for (const sport of SPORTS) {
          for (const [orgName, org] of Object.entries(ORGS)) {
            for (const keys of [ALL, FEW]) {
              const tag = `${e.id}/${side}/${sport}/${orgName}/${keys.length}`;
              const l = gallerySeed(e, shape(keys, 'public', 'classic'), org, side, sport);
              expect(validateLayout(l), tag).toEqual([]);
              expect(byId(compactLayout(l.widgets)), tag).toEqual(byId(l.widgets));
              expect(l.widgets[0].key, tag).toBe('hero');
              expect(l.widgets[0]).toMatchObject({ x: 0, y: 0, w: 12 });
              expect(new Set(l.widgets.map(w => w.id)).size, tag).toBe(l.widgets.length);
              expect(l.widgets.length, tag).toBeLessThanOrEqual(LAYOUT_WIDGETS_MAX);
              // Every module the org enables appears exactly once unless the entry omits the rest.
              const moduleKeys = l.widgets.filter(w => !isContentWidgetKey(w.key)).map(w => w.key);
              expect(new Set(moduleKeys).size, tag).toBe(moduleKeys.length);
              for (const k of moduleKeys) expect(keys as readonly string[], tag).toContain(k);
              if (e.rest !== 'omit') expect([...moduleKeys].sort(), tag).toEqual([...keys].sort());
              for (const w of l.widgets) {
                if (!isContentWidgetKey(w.key)) {
                  expect(w.id, tag).toBe(`legacy:${w.key}`);
                  continue;
                }
                expect(instanceSchemaFor(w.key).safeParse(w.config).success, `${tag}:${w.id}`).toBe(true);
                expect(isWidgetEmpty(w, EMPTY_DATA, site), `${tag}:${w.id}`).toBe(false);
              }
              const hasMap = l.widgets.some(w => w.id === MAP_ID);
              const wantsMap = e.slots.some(s => 'content' in s && s.content === 'map');
              expect(hasMap, tag).toBe(wantsMap && galleryMap(org) !== null);
              const wantsWelcome = e.slots.some(s => 'content' in s && s.content === 'welcome');
              expect(l.widgets.some(w => w.id === WELCOME_ID), tag).toBe(wantsWelcome);
            }
          }
        }
      }
    }
  });

  it('flows 12s on their own row and 6s in pairs; the family decides the seed order of the rest', () => {
    const l = gallerySeed(galleryEntry('simple')!, shape(ALL), ORG, 'club', 'golf');
    const find = (id: string) => l.widgets.find(w => w.id === id)!;
    expect(find(WELCOME_ID)).toMatchObject({ x: 0, w: 12 });
    expect(find('legacy:schedule')).toMatchObject({ x: 0, w: 6 });
    expect(find('legacy:contact')).toMatchObject({ x: 6, w: 6 });
    expect(find('legacy:schedule').y).toBe(find('legacy:contact').y);
    expect(l.widgets.map(w => w.key)).toEqual(['hero', 'text', 'schedule', 'contact']);
    // A plan that names a disabled module skips it; the pair re-forms with the next 6.
    const few = gallerySeed(galleryEntry('golf-clubhouse')!, shape(['hero', 'standings', 'contact']), ORG, 'club', 'golf');
    expect(few.widgets.map(w => w.key)).toEqual(['hero', 'text', 'standings', 'embed', 'contact']);
    expect(few.widgets.find(w => w.id === MAP_ID)!.x).toBe(0);
    expect(few.widgets.find(w => w.id === 'legacy:contact')!.x).toBe(6);
  });
});

describe('applyGallerySeed — keep and clean', () => {
  const org = ORG;
  const entry = galleryEntry('golf-tour')!;
  const seedFor = (keys: readonly string[]) => gallerySeed(entry, shape(keys, 'public', 'bold'), org, 'league', 'golf');
  const stored = (): SiteLayout => {
    const l = seedLayout(shape(['hero', 'standings', 'schedule', 'news', 'contact'], 'private', 'classic'));
    const widgets: WidgetInstance[] = l.widgets.map(w =>
      w.key === 'standings' ? { ...w, id: 'std_1', config: { title: 'Division A' }, visibility: 'members' as const } : w
    );
    widgets.push({ id: 'std_2', key: 'standings', x: 0, y: 50, w: 12, h: 4, cv: 1, config: { title: 'Division B', query: { competitionId: '5e2f1a3b-1c2d-4e5f-8a9b-0c1d2e3f4a5b' } }, visibility: 'public' });
    widgets.push({ id: 'mine', key: 'text', x: 0, y: 60, w: 12, h: 3, cv: 1, config: { blocks: [{ type: 'paragraph', text: 'Mine' }] }, visibility: 'public' });
    widgets.push({ id: WELCOME_ID, key: 'text', x: 0, y: 70, w: 12, h: 3, cv: 1, config: { blocks: [{ type: 'heading', text: 'Edited welcome' }] }, visibility: 'public' });
    return { ...l, widgets: compactLayout(widgets) };
  };

  it('keep: modules take the plan’s cells by FIRST instance (id, title, visibility kept); the edited welcome keeps its words; everything else follows below', () => {
    const out = applyGallerySeed(stored(), seedFor(ALL), 'keep');
    expect(validateLayout(out)).toEqual([]);
    expect(byId(compactLayout(out.widgets))).toEqual(byId(out.widgets));
    const find = (id: string) => out.widgets.find(w => w.id === id);
    expect(find('std_1')).toMatchObject({ config: { title: 'Division A' }, visibility: 'members', w: 12 });
    expect(find('std_2')).toMatchObject({ config: { title: 'Division B' } });
    expect(find('mine')).toBeDefined();
    expect(find(WELCOME_ID)).toMatchObject({ config: { blocks: [{ type: 'heading', text: 'Edited welcome' }] } });
    expect(find(MAP_ID)).toMatchObject({ key: 'embed' });
    // Never a module the layout lacks — the seed named leaders/members/courses for the full set; the org has none.
    for (const k of ['leaders', 'members', 'courses', 'gallery', 'teams']) expect(out.widgets.some(w => w.key === k), k).toBe(false);
    expect(out.widgets.filter(w => w.key === 'standings')).toHaveLength(2);
    expect(out.widgets.length).toBe(stored().widgets.length + 1); // + the map
    // The plan's order leads; the extras (std_2, mine) sit below the placed cells.
    const yOf = (id: string) => find(id)!.y;
    expect(yOf('std_1')).toBeLessThan(yOf('std_2'));
    expect(yOf('legacy:contact')).toBeLessThan(yOf('mine'));
    // Idempotent: a second application is a no-op.
    expect(byId(applyGallerySeed(out, seedFor(ALL), 'keep').widgets)).toEqual(byId(out.widgets));
  });

  it('clean: the manager’s content tiles and repeats go first; rest-omit drops the unnamed modules; the welcome is regenerated', () => {
    const out = applyGallerySeed(stored(), seedFor(ALL), 'clean');
    const ids = out.widgets.map(w => w.id);
    expect(ids).not.toContain('mine');
    expect(ids).not.toContain('std_2');
    expect(ids).toContain('std_1');
    expect((out.widgets.find(w => w.id === WELCOME_ID)!.config as { blocks: { text: string }[] }).blocks[0].text).toBe('Welcome to Kanata Golf Club');
    expect(out.widgets.some(w => w.key === 'news')).toBe(true); // golf-tour appends the rest
    const simple = applyGallerySeed(stored(), gallerySeed(galleryEntry('simple')!, shape(ALL), org, 'league', 'golf'), 'clean', true);
    expect(simple.widgets.map(w => w.key).sort()).toEqual(['contact', 'hero', 'schedule', 'text']);
    expect(validateLayout(simple)).toEqual([]);
    // Keep + omit flag: the unnamed modules SURVIVE (omit only bites in clean mode).
    const keepOmit = applyGallerySeed(stored(), gallerySeed(galleryEntry('simple')!, shape(ALL), org, 'league', 'golf'), 'keep', true);
    expect(keepOmit.widgets.some(w => w.key === 'news')).toBe(true);
    expect(keepOmit.widgets.some(w => w.id === 'mine')).toBe(true);
  });

  it('a module instance too narrow for its constraints is widened when it falls to the rest', () => {
    const l = stored();
    const narrow: SiteLayout = { ...l, widgets: l.widgets.map(w => (w.key === 'news' ? { ...w, w: 4 } : w)) };
    const out = applyGallerySeed(narrow, gallerySeed(galleryEntry('simple')!, shape(ALL), org, 'league', 'golf'), 'keep');
    expect(validateLayout(out)).toEqual([]);
  });
});
