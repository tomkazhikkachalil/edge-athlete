/**
 * The template gallery — Site Builder phase 11 (Sep 9 2026).
 *
 * A gallery ENTRY is a starting point for a whole page: a template FAMILY
 * (`classic | bold` — the DB's `template_id`, unchanged: zero DDL), a few
 * design tokens, and a SEED PLAN — which modules where, and where the
 * generated CONTENT tiles go: a welcome paragraph written from the org's
 * own name, sport and place, and a map of where it plays when a venue has
 * coordinates. Six entries cover every side × sport (pinned by test).
 *
 * Applying an entry (`applyGallerySeed`) never destroys: the first
 * instance of each module key the plan names takes the plan's cell and
 * size and keeps its id, title and visibility; a generated tile is matched
 * by its seed id (re-applying keeps edited words); everything else follows
 * below. It never CREATES a module instance the layout lacks — a private
 * club's members-only tiles carry their visibility on the instance, and
 * the snapshot does not know the org's visibility — so a plan can only
 * arrange what is there and add content. `clean` first drops the manager's
 * own content tiles and repeats (and, with `rest: 'omit'`, the modules the
 * plan does not name).
 *
 * CLIENT-SAFE (the editor's gallery renders thumbnails from the same
 * seed the server applies): no zod, no validate.ts.
 */

import { MEMBERS_ONLY_MODULE_KEYS } from '@/lib/org-sites/private';
import { type TemplateId } from '@/lib/org-sites/templates';
import { INSTANCE_TITLE_MAX } from './config';
import { WIDGETS, isContentWidgetKey, isGameWidgetKey, type GameWidgetKey, type WebWidgetKey } from './catalog';
import { osmEmbedAround, type Embed } from './embeds';
import { GALLERY_ENTRY_IDS, type GalleryEntryId, type GalleryMode } from './gallery-ids';
import { GRID, clampToConstraints, compactLayout, layoutBottom, sortByPosition, type LegacySiteShape, type SiteLayout, type WidgetInstance } from './layout';
import { place, seedLayout } from './seeds';
import type { OrgKind } from '@/lib/orgs/org-ref';

export { GALLERY_ENTRY_IDS, type GalleryEntryId, type GalleryMode };

export type GallerySport = 'golf' | 'team';
export const gallerySport = (sportKey: string | null | undefined): GallerySport => (sportKey === 'golf' ? 'golf' : 'team');

export interface GalleryVenue {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** What the generated content is written from (the server loads it once). */
export interface GalleryOrg {
  orgName: string;
  city: string | null;
  region: string | null;
  venues: GalleryVenue[];
}

export type GalleryDesignTokens = Partial<Record<'typeface' | 'header' | 'hero' | 'density' | 'teams' | 'width', string>>;

/** One row of a plan, flowed in order: 12 = its own row, 6 = pairs left/right. */
export type GallerySlot =
  | { module: WebWidgetKey; w: 6 | 12; h?: number }
  | { content: 'welcome' | 'map'; w: 6 | 12; h?: number }
  /** L6: a game-day tile, MINTED by the seed (it is not a module — its
   *  audience is its module's at render), placed only while that module is
   *  on; `variant` is its display layout. */
  | { game: GameWidgetKey; w: 6 | 12; h?: number; variant?: string };

export interface GalleryEntry {
  id: GalleryEntryId;
  family: TemplateId;
  name: string;
  blurb: string;
  forSides: readonly (OrgKind)[];
  forSports: readonly GallerySport[];
  tokens: GalleryDesignTokens;
  slots: readonly GallerySlot[];
  /** Enabled modules the plan does not name: appended below (default) or,
   *  in clean mode, dropped. */
  rest?: 'append' | 'omit';
}

export const WELCOME_ID = 'seed:welcome';
export const MAP_ID = 'seed:map';
/** L6: a game tile's seed id (re-applying matches it, like the welcome). */
export const gameSeedId = (key: GameWidgetKey): string => `seed:${key}`;

/** Tiles the seed MINTS and matches by id — the generated content and the
 *  game-day tiles — as opposed to module tiles, which it only arranges. */
export function isSeedMinted(key: string): boolean {
  return isContentWidgetKey(key) || isGameWidgetKey(key);
}

const BOTH_SIDES = ['league', 'club'] as const;
const BOTH_SPORTS = ['golf', 'team'] as const;

export const GALLERY_ENTRIES: readonly GalleryEntry[] = [
  {
    id: 'golf-clubhouse',
    family: 'classic',
    name: 'Clubhouse',
    blurb: 'A warm welcome, the season table, the leaders, and where the club plays.',
    forSides: ['club'],
    forSports: ['golf'],
    tokens: { typeface: 'playfair', density: 'comfortable' },
    slots: [
      { module: 'hero', w: 12 },
      { content: 'welcome', w: 6, h: 3 },
      { module: 'standings', w: 6, h: 4 },
      { module: 'leaders', w: 12 },
      { module: 'schedule', w: 6 },
      { module: 'members', w: 6 },
      { module: 'news', w: 12 },
      { module: 'courses', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
      { module: 'gallery', w: 12 },
    ],
  },
  {
    id: 'golf-tour',
    family: 'bold',
    name: 'Tour',
    blurb: 'The standings lead, big and bold; leaders and the week’s play beside them.',
    forSides: BOTH_SIDES,
    forSports: ['golf'],
    tokens: { typeface: 'oswald', header: 'band', hero: 'bleed', density: 'compact' },
    slots: [
      { module: 'hero', w: 12 },
      { module: 'standings', w: 12, h: 5 },
      { module: 'leaders', w: 6 },
      { module: 'schedule', w: 6 },
      { content: 'welcome', w: 6 },
      { module: 'news', w: 6 },
      { module: 'gallery', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'team-clubhouse',
    family: 'classic',
    name: 'Clubhouse',
    blurb: 'A welcome and the schedule first, then the teams, the table and the news.',
    forSides: ['club'],
    forSports: ['team'],
    tokens: { typeface: 'nunito' },
    slots: [
      { module: 'hero', w: 12 },
      { content: 'welcome', w: 6 },
      { module: 'schedule', w: 6 },
      { module: 'teams', w: 12 },
      { module: 'standings', w: 6 },
      { module: 'news', w: 6 },
      { module: 'register', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'team-scoreboard',
    family: 'bold',
    name: 'Scoreboard',
    blurb: 'Standings and schedule side by side, teams as tiles, compact and quick.',
    forSides: BOTH_SIDES,
    forSports: ['team'],
    tokens: { typeface: 'oswald', density: 'compact', teams: 'tiles' },
    slots: [
      { module: 'hero', w: 12 },
      { module: 'standings', w: 6 },
      { module: 'schedule', w: 6 },
      { module: 'teams', w: 12 },
      { content: 'welcome', w: 6 },
      { module: 'news', w: 6 },
      { module: 'register', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'community',
    family: 'bold',
    name: 'Community',
    blurb: 'News and photos up top — for the club that is about the people in it.',
    forSides: BOTH_SIDES,
    forSports: BOTH_SPORTS,
    tokens: { typeface: 'nunito', header: 'bar', hero: 'card' },
    slots: [
      { module: 'hero', w: 12 },
      { module: 'news', w: 12 },
      { module: 'gallery', w: 12 },
      { content: 'welcome', w: 6 },
      { module: 'schedule', w: 6 },
      { module: 'teams', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'simple',
    family: 'classic',
    name: 'Simple',
    blurb: 'A welcome, the schedule and how to reach you — nothing else.',
    forSides: BOTH_SIDES,
    forSports: BOTH_SPORTS,
    tokens: {},
    slots: [
      { module: 'hero', w: 12 },
      { content: 'welcome', w: 12, h: 2 },
      { module: 'schedule', w: 6 },
      { module: 'contact', w: 6 },
    ],
    rest: 'omit',
  },
  // ── Sep 11 2026: the golf shapes a manager expects at sign-up ─────────────
  // Tom: "weekly league, club or society, season tour points race, casual
  // group". Clubhouse is the society; Tour is the full bleed site; these three
  // are the rhythm designs. Data only — the same modules, the same engine.
  {
    id: 'golf-weekly',
    family: 'classic',
    name: 'Weekly league',
    blurb: 'This week’s round first, then the table, the leaders and who’s playing.',
    forSides: BOTH_SIDES,
    forSports: ['golf'],
    tokens: { typeface: 'nunito', density: 'compact' },
    slots: [
      { module: 'hero', w: 12 },
      { module: 'schedule', w: 6, h: 4 },
      { module: 'standings', w: 6, h: 4 },
      { module: 'leaders', w: 12 },
      { module: 'members', w: 6 },
      { content: 'welcome', w: 6, h: 3 },
      { module: 'news', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'golf-points-race',
    family: 'bold',
    name: 'Points race',
    blurb: 'Tables first and lean: the order of merit, the leaders, the rounds to come.',
    forSides: BOTH_SIDES,
    forSports: ['golf'],
    tokens: { typeface: 'oswald', header: 'band', hero: 'card', density: 'compact' },
    slots: [
      { module: 'hero', w: 12 },
      { module: 'standings', w: 12, h: 6 },
      { module: 'leaders', w: 12 },
      { module: 'schedule', w: 6 },
      { module: 'members', w: 6 },
      { content: 'welcome', w: 6 },
      { module: 'contact', w: 6 },
    ],
    rest: 'omit',
  },
  {
    id: 'golf-social',
    family: 'classic',
    name: 'Social',
    blurb: 'A casual group: the welcome, the people, the photos and when you play — no table.',
    forSides: BOTH_SIDES,
    forSports: ['golf'],
    tokens: { typeface: 'lora', density: 'comfortable' },
    slots: [
      { module: 'hero', w: 12 },
      { content: 'welcome', w: 12, h: 2 },
      { module: 'members', w: 6 },
      { module: 'gallery', w: 6 },
      { module: 'schedule', w: 6 },
      { module: 'news', w: 6 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
    rest: 'omit',
  },
  // ── Sep 28 2026 (sports-team website program, L6): game-day designs ──────
  // Tom: "look like a professional site" — the pro header, a wide page, the
  // next game and the latest results leading. Data only, the same engine.
  {
    id: 'team-matchday',
    family: 'bold',
    name: 'Matchday',
    blurb: 'The next game leads as a banner, then the scores, the table and the news.',
    forSides: BOTH_SIDES,
    forSports: ['team'],
    tokens: { typeface: 'oswald', header: 'pro', width: 'wide', hero: 'bleed', density: 'compact', teams: 'tiles' },
    slots: [
      { module: 'hero', w: 12 },
      { game: 'next_game', w: 12, variant: 'banner' },
      { game: 'results', w: 6, variant: 'strip' },
      { module: 'standings', w: 6 },
      { module: 'news', w: 12 },
      { module: 'teams', w: 12 },
      { module: 'sponsors', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'club-teams-pro',
    family: 'classic',
    name: 'Club pro',
    blurb: 'A club of teams: the welcome and the next game, every team, results and how to join.',
    forSides: ['club'],
    forSports: ['team'],
    tokens: { typeface: 'nunito', header: 'pro', width: 'wide', teams: 'tiles' },
    slots: [
      { module: 'hero', w: 12 },
      { content: 'welcome', w: 6 },
      { game: 'next_game', w: 6 },
      { module: 'teams', w: 12 },
      { game: 'results', w: 6 },
      { module: 'news', w: 6 },
      { module: 'register', w: 12 },
      { module: 'sponsors', w: 12 },
      { content: 'map', w: 6, h: 5 },
      { module: 'contact', w: 6, h: 5 },
    ],
  },
  {
    id: 'league-central',
    family: 'bold',
    name: 'League central',
    blurb: 'The scores strip on top, the table and the next game, the leaders and the news.',
    forSides: ['league'],
    forSports: ['team'],
    tokens: { typeface: 'oswald', header: 'pro', width: 'wide', hero: 'card', density: 'compact' },
    slots: [
      { module: 'hero', w: 12 },
      { game: 'results', w: 12, variant: 'strip' },
      { module: 'standings', w: 6 },
      { game: 'next_game', w: 6 },
      { module: 'leaders', w: 6 },
      { module: 'news', w: 6 },
      { module: 'teams', w: 12 },
      { module: 'sponsors', w: 12 },
      { module: 'contact', w: 12 },
    ],
  },
];

export function galleryEntry(id: string): GalleryEntry | null {
  return GALLERY_ENTRIES.find(e => e.id === id) ?? null;
}

export function galleryEntriesFor(side: OrgKind, sportKey: string | null | undefined): GalleryEntry[] {
  const sport = gallerySport(sportKey);
  return GALLERY_ENTRIES.filter(e => e.forSides.includes(side) && e.forSports.includes(sport));
}

// ── Generated content ───────────────────────────────────────────────────────

const HEADING_MAX = 120;
const PARAGRAPH_MAX = 2000;

/** Clip to a schema cap, never mid-word when it can be helped. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A neutral org when the server hands the reducer no facts (tests, an
 *  org row that vanished): the copy still reads, still validates. */
export const NEUTRAL_ORG = (side: OrgKind): GalleryOrg => ({ orgName: side === 'club' ? 'our club' : 'our league', city: null, region: null, venues: [] });

const humanSport = (sportKey: string | null): string => (sportKey ? sportKey.replace(/_/g, ' ') : 'sports');

/** The welcome tile's blocks: a heading and one paragraph by side × sport. */
export function galleryWelcome(org: GalleryOrg, side: OrgKind, sportKey: string | null): { heading: string; paragraph: string } {
  const name = clip(org.orgName || NEUTRAL_ORG(side).orgName, 80);
  const loc = org.city ? ` in ${org.city}${org.region ? `, ${org.region}` : ''}` : '';
  const heading = clip(`Welcome to ${name}`, HEADING_MAX);
  let paragraph: string;
  if (sportKey === 'golf') {
    paragraph =
      side === 'club'
        ? `${name} is a golf club${loc}. Season standings, the leaders board and the week’s play are posted here as they happen — and you’ll find how to join.`
        : `${name} is a golf league${loc}. Standings, the leaders and each week’s play update as members post their rounds — and you’ll find how to join.`;
  } else {
    const sport = humanSport(sportKey);
    paragraph =
      side === 'club'
        ? `${name} is a ${sport} club${loc}. Schedules, teams and standings update as the season goes — and you’ll find how to join.`
        : `${name} is a ${sport} league${loc}. Standings, schedules and team pages update as the season goes — and you’ll find how to join.`;
  }
  return { heading, paragraph: clip(paragraph, PARAGRAPH_MAX) };
}

const finite = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);

/** The map tile — only when the first venue with coordinates exists. */
export function galleryMap(org: GalleryOrg): { title: string; venueName: string; embed: Embed } | null {
  const venue = org.venues.find(v => finite(v.lat) && finite(v.lng) && Math.abs(v.lat as number) <= 90 && Math.abs(v.lng as number) <= 180);
  if (!venue) return null;
  return { title: clip('Where we play', INSTANCE_TITLE_MAX), venueName: venue.name, embed: osmEmbedAround(venue.lat as number, venue.lng as number, 15) };
}

// ── The engine ──────────────────────────────────────────────────────────────

/** The entry's seed for THIS org: its enabled modules placed as the plan
 *  says (disabled modules and empty content skipped), the rest appended
 *  full width in row order (unless `rest: 'omit'`), compacted. Module ids
 *  are the legacy ids so an untouched site's instances match by key AND id. */
export function gallerySeed(
  entry: GalleryEntry,
  shape: LegacySiteShape & { template_id: string },
  org: GalleryOrg,
  side: OrgKind,
  sportKey: string | null
): SiteLayout {
  const enabledOrder = seedLayout({ ...shape, template_id: entry.family }).widgets.map(w => w.key);
  const enabled = new Set<string>(enabledOrder);
  const widgets: WidgetInstance[] = [];
  const placed = new Set<string>();
  let y = 0;
  let col = 0;
  let rowH = 0;
  const closeRow = () => {
    if (col === 1) {
      y += rowH;
      col = 0;
      rowH = 0;
    }
  };
  const put = (instance: WidgetInstance, w: 6 | 12, h: number) => {
    if (w === 12) {
      closeRow();
      widgets.push({ ...instance, x: 0, y, w: 12, h });
      y += h;
    } else if (col === 0) {
      widgets.push({ ...instance, x: 0, y, w: 6, h });
      col = 1;
      rowH = h;
    } else {
      widgets.push({ ...instance, x: 6, y, w: 6, h });
      y += Math.max(rowH, h);
      col = 0;
      rowH = 0;
    }
  };
  // The hero always leads, whatever the plan says.
  if (enabled.has('hero')) {
    put(place('hero', 0, 0, undefined, { id: 'legacy:hero' }), 12, WIDGETS.hero.constraints.defaultSize.h);
    placed.add('hero');
  }
  for (const slot of entry.slots) {
    if ('module' in slot) {
      if (slot.module === 'hero' || !enabled.has(slot.module) || placed.has(slot.module)) continue;
      const c = WIDGETS[slot.module].constraints;
      const h = Math.max(c.minH, Math.min(c.maxH, slot.h ?? c.defaultSize.h));
      put(place(slot.module, 0, 0, undefined, { id: `legacy:${slot.module}`, visibility: shape.visibility === 'private' && isMembersOnlyKey(slot.module) ? 'members' : 'public' }), slot.w, h);
      placed.add(slot.module);
    } else if ('game' in slot) {
      // L6: minted, never arranged — only while its module is on.
      const moduleKey = WIDGETS[slot.game].moduleKey;
      if (moduleKey && !enabled.has(moduleKey)) continue;
      const c = WIDGETS[slot.game].constraints;
      const h = Math.max(c.minH, Math.min(c.maxH, slot.h ?? c.defaultSize.h));
      put(place(slot.game, 0, 0, undefined, { id: gameSeedId(slot.game), config: slot.variant ? { display: { variant: slot.variant } } : {} }), slot.w, h);
    } else if (slot.content === 'welcome') {
      const w = galleryWelcome(org, side, sportKey);
      put(
        place('text', 0, 0, undefined, {
          id: WELCOME_ID,
          config: { blocks: [{ type: 'heading', text: w.heading }, { type: 'paragraph', text: w.paragraph }] },
        }),
        slot.w,
        Math.max(WIDGETS.text.constraints.minH, slot.h ?? 3)
      );
    } else {
      const m = galleryMap(org);
      if (!m) continue;
      put(place('embed', 0, 0, undefined, { id: MAP_ID, config: { title: m.title, embed: m.embed } }), slot.w, Math.max(WIDGETS.embed.constraints.minH, slot.h ?? 5));
    }
  }
  closeRow();
  if (entry.rest !== 'omit') {
    for (const key of enabledOrder) {
      if (placed.has(key)) continue;
      const c = WIDGETS[key].constraints;
      put(place(key, 0, 0, undefined, { id: `legacy:${key}`, visibility: shape.visibility === 'private' && isMembersOnlyKey(key) ? 'members' : 'public' }), 12, c.defaultSize.h);
      placed.add(key);
    }
  }
  return { version: 1, cols: GRID.cols, widgets: compactLayout(widgets) };
}

// B5: the one list — private.ts has zero imports and is already in this graph.
const MEMBERS_ONLY = new Set<string>(MEMBERS_ONLY_MODULE_KEYS);
const isMembersOnlyKey = (key: string) => MEMBERS_ONLY.has(key);

/** Re-lay an existing layout with an entry's seed — see the header. */
export function applyGallerySeed(layout: SiteLayout, seed: SiteLayout, mode: GalleryMode, omitRest = false, max = Number.POSITIVE_INFINITY): SiteLayout {
  let current = sortByPosition(layout.widgets);
  if (mode === 'clean') {
    const seen = new Set<string>();
    current = current.filter(w => {
      if (isSeedMinted(w.key)) return false;
      if (seen.has(w.key)) return false;
      seen.add(w.key);
      return true;
    });
  }
  const used = new Set<string>();
  const placed: WidgetInstance[] = [];
  for (const s of sortByPosition(seed.widgets)) {
    if (isSeedMinted(s.key)) {
      const existing = current.find(w => w.id === s.id);
      if (existing) {
        used.add(existing.id);
        placed.push({ ...existing, x: s.x, y: s.y, w: s.w, h: s.h });
      } else {
        placed.push(s);
      }
      continue;
    }
    // A module: the first existing instance of that key takes the cell —
    // never a new instance (its visibility belongs to the org).
    const existing = current.find(w => w.key === s.key && !used.has(w.id));
    if (!existing) continue;
    used.add(existing.id);
    placed.push(clampToConstraints({ ...existing, x: s.x, y: s.y, w: s.w, h: Math.max(s.h, WIDGETS[existing.key].constraints.minH) }));
  }
  const seedKeys = new Set(seed.widgets.map(w => w.key));
  let y = layoutBottom(placed);
  const rest = current
    .filter(w => !used.has(w.id))
    .filter(w => !(mode === 'clean' && omitRest && !isSeedMinted(w.key) && !seedKeys.has(w.key)))
    .map(w => {
      const out = clampToConstraints({ ...w, x: 0, y });
      y += out.h;
      return out;
    })
    // H4: the cap — the rest tail beyond `max` is dropped (the plan's
    // placed cells and the generated content always fit; a layout past the
    // schema's cap would parse as null and revert the page to its seed).
    .slice(0, Math.max(0, max - placed.length));
  return { ...layout, widgets: compactLayout([...placed, ...rest]) };
}
