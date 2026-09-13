import type { SiteHomeData } from '@/lib/org-sites/home-data';
import type { SiteWidgetKey } from './catalog';
import type { WidgetInstance } from './layout';

/**
 * Display settings — Site Builder program 3, D1 (Sep 13 2026).
 *
 * Every section presents its items along the SAME four axes — `variant`
 * (the layout), `sort` (+ `order`, the manager's own order when `sort` is
 * manual), `count` (how many items show) and `click` (what a tap does) —
 * declared here ONCE per widget and generated everywhere else:
 *  • `schemas.ts` BUILDS the zod schema from this declaration (a choice is
 *    `z.enum` of its options, a count its bounds), so the validator can
 *    never drift from the panel;
 *  • the properties panel renders the "How it looks" fieldset from it;
 *  • the renderers read `instanceDisplay(w)`, which fills every declared
 *    key with a validated value or its DEFAULT — the first option, the
 *    declared default count, `false` — so an instance with no `display`
 *    renders exactly as it did before this round (the identity pin).
 *
 * `display` is ONE nested key on the instance, read from the INSTANCE
 * only (never through `effectiveConfig`), exactly the rule `query` set:
 * content from the org objects can never shadow how a tile presents.
 * CLIENT-SAFE: no zod, no validate.ts — the editor bundle reads it.
 *
 * A widget that would get a single meaningless axis simply omits it — the
 * declaration is the truth and the panel never shows a dead control. Where
 * a widget already carries a QUERY `limit`, that limit IS its count (the
 * query decides what is fetched); `count` is declared only for widgets
 * whose components used to hardcode a slice.
 */

export type DisplayChoice = { kind: 'choice'; name: string; label: string; help?: string; options: readonly { value: string; label: string }[] };
export type DisplayCount = { kind: 'count'; name: string; label: string; help?: string; min: number; max: number; default: number };
export type DisplayToggle = { kind: 'toggle'; name: string; label: string; help?: string; default?: boolean };
/** The manager's own order — a list of item ids, edited with the reorder
 *  control; shown only while `sort` is 'manual'. */
export type DisplayOrder = { kind: 'order'; name: 'order'; label: string; help?: string };
/** A short free text a presentation needs (a form's button label). */
export type DisplayText = { kind: 'text'; name: string; label: string; help?: string; max: number; placeholder?: string };
export type DisplayField = DisplayChoice | DisplayCount | DisplayToggle | DisplayOrder | DisplayText;

/** Program 3, D2 — the sponsor tier ladder (Tom: a FIXED ladder). Grouping
 *  and the tier sort follow this order; a sponsor without a tier comes last. */
export const SPONSOR_TIERS = ['platinum', 'gold', 'silver', 'bronze', 'partner'] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];
export const SPONSOR_TIER_LABELS: Record<SponsorTier, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', partner: 'Partner' };
export const tierRank = (tier: string | undefined): number => {
  const i = (SPONSOR_TIERS as readonly string[]).indexOf(tier ?? '');
  return i === -1 ? SPONSOR_TIERS.length : i;
};

/** Program 3, H3 — the contact card's fields, in today's render order; the
 *  manager's `contact_config.order` re-orders them (H3). */
export const CONTACT_FIELD_ORDER = ['address', 'hours', 'directions', 'email', 'phone', 'website', 'social'] as const;
export type ContactFieldKey = (typeof CONTACT_FIELD_ORDER)[number];
export const CONTACT_FIELD_LABELS: Record<ContactFieldKey, string> = { address: 'Address', hours: 'Hours', directions: 'Directions', email: 'Email', phone: 'Phone', website: 'Website', social: 'Social links' };
/** The stored order filtered to known keys (unknown dropped, duplicates
 *  once), the rest appended in today's order — an untouched card renders
 *  exactly as before. */
export function contactRenderOrder(order: readonly string[] | undefined): ContactFieldKey[] {
  const out: ContactFieldKey[] = [];
  for (const k of order ?? []) if ((CONTACT_FIELD_ORDER as readonly string[]).includes(k) && !out.includes(k as ContactFieldKey)) out.push(k as ContactFieldKey);
  for (const k of CONTACT_FIELD_ORDER) if (!out.includes(k)) out.push(k);
  return out;
}

export const DISPLAY_ORDER_MAX = 60;
export const DISPLAY_ORDER_ID_MAX = 120;

const choice = (name: string, label: string, options: readonly (readonly [string, string])[], help?: string): DisplayChoice => ({
  kind: 'choice',
  name,
  label,
  help,
  options: options.map(([value, l]) => ({ value, label: l })),
});
const count = (name: string, label: string, min: number, max: number, dflt: number, help?: string): DisplayCount => ({ kind: 'count', name, label, help, min, max, default: dflt });
const toggle = (name: string, label: string, dflt = false, help?: string): DisplayToggle => ({ kind: 'toggle', name, label, help, default: dflt });
const ORDER: DisplayOrder = { kind: 'order', name: 'order', label: 'Your order', help: 'Drag, or use the arrows. New items join at the end.' };
const text = (name: string, label: string, max: number, placeholder?: string, help?: string): DisplayText => ({ kind: 'text', name, label, help, max, placeholder });

/** Program 3, H1 — the section's height: fits its content (today), or the
 *  rows the manager set, scrolling inside. On every widget but the hero
 *  (the site's identity — a fixed hero would clip its photo). */
export const HEIGHT_FIELD: DisplayChoice = choice('height', 'Height', [
  ['auto', 'Fits the content'],
  ['fixed', 'Fixed — scrolls inside'],
], 'Drag the section shorter than its content on the canvas and it turns fixed.');

/** `click` — the item's existing page or link, or nothing. */
const CLICK_DETAIL = choice('click', 'Tap on an item', [
  ['detail', 'Opens its page'],
  ['none', 'Nothing'],
]);

/** The declaration — first option = today's look. Every site widget
 *  declares at least one axis (program 3, D1–D4). */
const DECLARED: Readonly<Record<SiteWidgetKey, readonly DisplayField[]>> = {
  hero: [
    choice('variant', 'Welcome shape', [
      ['theme', 'As the theme'],
      ['card', 'Card'],
      ['bleed', 'Full width'],
    ]),
    choice('align', 'Text', [
      ['left', 'Left'],
      ['center', 'Centred'],
    ]),
  ],
  standings: [
    choice('variant', 'Layout', [
      ['compact', 'Rank, name and points'],
      ['full', 'Every column'],
    ]),
    count('count', 'Rows', 3, 20, 5),
    choice('sort', 'Order', [
      ['rank', 'By rank'],
      ['name', 'A to Z'],
    ]),
    CLICK_DETAIL,
  ],
  schedule: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['cards', 'Cards'],
    ]),
    choice('sort', 'Order', [
      ['soonest', 'Soonest first'],
      ['latest', 'Latest first'],
    ]),
    CLICK_DETAIL,
  ],
  teams: [
    choice('variant', 'Layout', [
      ['theme', 'As the theme'],
      ['chips', 'Name chips'],
      ['tiles', 'Tiles'],
      ['list', 'List with divisions'],
    ]),
    choice('sort', 'Order', [
      ['default', 'As entered'],
      ['alpha', 'A to Z'],
      ['division', 'By division'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    CLICK_DETAIL,
  ],
  staff: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['grid', 'Grid'],
    ]),
    choice('sort', 'Order', [
      ['role', 'Owners first'],
      ['alpha', 'A to Z'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    count('count', 'How many', 1, 20, 20),
  ],
  venues: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['cards', 'Cards'],
    ]),
    choice('sort', 'Order', [
      ['default', 'As entered'],
      ['alpha', 'A to Z'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    count('count', 'How many', 1, 20, 20),
    choice('click', 'Tap on a venue', [
      ['none', 'Nothing'],
      ['directions', 'Opens directions'],
    ]),
  ],
  affiliations: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['badges', 'Badges'],
    ]),
    choice('sort', 'Order', [
      ['default', 'As entered'],
      ['alpha', 'A to Z'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    count('count', 'How many', 1, 20, 20),
  ],
  sponsors: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['grid', 'Grid of logos'],
      ['row', 'One row'],
      ['carousel', 'Carousel'],
    ]),
    toggle('groupByTier', 'Group by tier'),
    choice('logoSize', 'Logo size', [
      ['sm', 'Small'],
      ['md', 'Medium'],
      ['lg', 'Large'],
    ]),
    count('perRow', 'Logos per row', 2, 6, 3, 'For the grid.'),
    choice('sort', 'Order', [
      ['manual', 'My own order'],
      ['alpha', 'A to Z'],
      ['tier', 'By tier'],
    ]),
    choice('click', 'Tap on a sponsor', [
      ['link', 'Opens its link'],
      ['none', 'Nothing'],
    ]),
  ],
  contact: [
    choice('variant', 'Layout', [
      ['card', 'Stacked'],
      ['inline', 'One line of links'],
      ['split', 'Two columns'],
    ]),
    toggle('showSocials', 'Show social links', true),
  ],
  news: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['grid', 'Grid of cards'],
      ['featured', 'Featured post, then a list'],
    ]),
    choice('sort', 'Order', [
      ['newest', 'Newest first'],
      ['pinned', 'Pinned first'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    choice('click', 'Tap on a post', [
      ['detail', 'Opens the post'],
      ['inline', 'Expands in place'],
    ]),
  ],
  gallery: [
    choice('variant', 'Layout', [
      ['teaser', 'A link to the gallery'],
      ['strip', 'A strip of photos'],
      ['grid', 'A grid of photos'],
    ]),
    count('count', 'Photos shown', 3, 12, 6),
  ],
  register: [
    choice('variant', 'Layout', [
      ['list', 'Open windows and the button'],
      ['button', 'The button only'],
    ]),
    choice('sort', 'Order', [
      ['closing', 'Closing soonest first'],
      ['opening', 'Opened latest first'],
    ]),
    count('count', 'Windows shown', 1, 5, 5),
  ],
  courses: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['cards', 'Cards'],
    ]),
    choice('sort', 'Order', [
      ['default', 'As entered'],
      ['alpha', 'A to Z'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    count('count', 'How many', 1, 20, 20),
    CLICK_DETAIL,
    toggle('showRounds', 'Show members’ rounds', true, 'The rounds posted this year and “this week at the club”.'),
  ],
  divisions: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['grid', 'Grid'],
    ]),
    choice('sort', 'Order', [
      ['default', 'As entered'],
      ['alpha', 'A to Z'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    count('count', 'How many', 1, 20, 8),
  ],
  leaders: [
    choice('variant', 'Layout', [
      ['table', 'Table'],
      ['podium', 'Podium'],
    ]),
    count('boards', 'Stats shown', 1, 4, 1),
    count('count', 'Rows per stat', 3, 10, 10),
    CLICK_DETAIL,
  ],
  documents: [
    choice('variant', 'Layout', [
      ['list', 'List'],
      ['grid', 'Grid'],
    ]),
    choice('sort', 'Order', [
      ['default', 'As entered'],
      ['alpha', 'A to Z'],
      ['manual', 'My own order'],
    ]),
    ORDER,
    count('count', 'How many', 1, 20, 5),
    choice('click', 'Tap on a document', [
      ['open', 'Opens in a new tab'],
      ['download', 'Downloads'],
    ]),
  ],
  members: [
    choice('variant', 'Layout', [
      ['table', 'Table'],
      ['cards', 'Cards'],
    ]),
    choice('sort', 'Order', [
      ['default', 'Most rounds first'],
      ['handicap', 'Lowest index first'],
      ['alpha', 'A to Z'],
    ]),
    CLICK_DETAIL,
  ],
  text: [
    choice('variant', 'Layout', [
      ['plain', 'Plain'],
      ['card', 'On a card'],
      ['columns', 'Two columns'],
    ]),
    choice('align', 'Text', [
      ['left', 'Left'],
      ['center', 'Centred'],
    ]),
  ],
  image: [
    choice('variant', 'Frame', [
      ['full', 'Edge to edge'],
      ['framed', 'Framed'],
    ]),
    choice('aspect', 'Shape', [
      ['natural', 'As taken'],
      ['wide', '16 : 9'],
      ['square', 'Square'],
    ]),
    choice('click', 'Tap on the photo', [
      ['link', 'Opens its link'],
      ['none', 'Nothing'],
    ]),
  ],
  embed: [
    choice('aspect', 'Shape', [
      ['wide', '16 : 9'],
      ['classic', '4 : 3'],
      ['square', 'Square'],
    ]),
  ],
  contact_form: [
    choice('variant', 'Layout', [
      ['stacked', 'Stacked'],
      ['columns', 'Two columns'],
    ]),
    text('button', 'Button label', 24, 'Send message'),
  ],
  interest_form: [
    choice('variant', 'Layout', [
      ['stacked', 'Stacked'],
      ['columns', 'Two columns'],
    ]),
    text('button', 'Button label', 24, 'Register interest'),
  ],
};

/** The declaration with the shared height axis appended (H1) — the hero excluded. */
export const DISPLAY_FIELDS: Readonly<Record<SiteWidgetKey, readonly DisplayField[]>> = Object.fromEntries(
  (Object.keys(DECLARED) as SiteWidgetKey[]).map(key => [key, key === 'hero' ? DECLARED[key] : [...DECLARED[key], HEIGHT_FIELD]])
) as Record<SiteWidgetKey, readonly DisplayField[]>;

export type DisplayValue = string | number | boolean | string[];
export type DisplayValues = Record<string, DisplayValue>;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The default value of a declared field. */
export function displayDefault(f: DisplayField): DisplayValue {
  switch (f.kind) {
    case 'choice':
      return f.options[0]?.value ?? '';
    case 'count':
      return f.default;
    case 'toggle':
      return f.default ?? false;
    case 'order':
      return [];
    case 'text':
      return '';
  }
}

/** The declared defaults for a widget — what an instance with no `display` renders with. */
export function displayDefaults(key: SiteWidgetKey): DisplayValues {
  const out: DisplayValues = {};
  for (const f of DISPLAY_FIELDS[key] ?? []) out[f.name] = displayDefault(f);
  return out;
}

/** The instance's display settings, validated against the declaration
 *  and filled with the defaults: an unknown choice, an out-of-range count,
 *  a non-boolean toggle or a malformed order falls back. Read from the
 *  INSTANCE only — content can never shadow presentation. */
export function instanceDisplay(w: WidgetInstance): DisplayValues {
  const key = w.key as SiteWidgetKey;
  const raw = asRecord(asRecord(w.config).display);
  const out = displayDefaults(key);
  for (const f of DISPLAY_FIELDS[key] ?? []) {
    const v = raw[f.name];
    switch (f.kind) {
      case 'choice':
        if (typeof v === 'string' && f.options.some(o => o.value === v)) out[f.name] = v;
        break;
      case 'count':
        if (typeof v === 'number' && Number.isInteger(v)) out[f.name] = Math.min(f.max, Math.max(f.min, v));
        break;
      case 'toggle':
        if (typeof v === 'boolean') out[f.name] = v;
        break;
      case 'order':
        if (Array.isArray(v)) out[f.name] = v.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= DISPLAY_ORDER_ID_MAX).slice(0, DISPLAY_ORDER_MAX);
        break;
      case 'text':
        if (typeof v === 'string') out[f.name] = v.trim().slice(0, f.max);
        break;
    }
  }
  return out;
}

/** Typed readers over the validated values. */
export const displayString = (d: DisplayValues, name: string, fallback = ''): string => (typeof d[name] === 'string' ? (d[name] as string) : fallback);
export const displayNumber = (d: DisplayValues, name: string, fallback: number): number => (typeof d[name] === 'number' ? (d[name] as number) : fallback);
export const displayBool = (d: DisplayValues, name: string, fallback = false): boolean => (typeof d[name] === 'boolean' ? (d[name] as boolean) : fallback);
export const displayOrder = (d: DisplayValues): string[] => (Array.isArray(d.order) ? (d.order as string[]) : []);

/** Items in the manager's order: listed ids first in that order, unknown
 *  ids dropped, items the list does not name appended in their default
 *  order. An empty order is the default order — an untouched instance
 *  renders exactly as before. Pure; never mutates. */
export function applyOrder<T>(items: readonly T[], order: readonly string[], idOf: (item: T) => string): T[] {
  if (order.length === 0) return [...items];
  const byId = new Map<string, T>();
  for (const it of items) if (!byId.has(idOf(it))) byId.set(idOf(it), it);
  const placed = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const it = byId.get(id);
    if (it !== undefined && !placed.has(id)) {
      out.push(it);
      placed.add(id);
    }
  }
  for (const it of items) if (!placed.has(idOf(it))) out.push(it);
  return out;
}

/** Stable alphabetical sort by a label (locale-aware, case-insensitive). */
export function sortAlpha<T>(items: readonly T[], labelOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' }));
}

/** The item id each manual-sort widget orders by — ONE rule shared by the
 *  panel (which lists the items) and the renderers (which apply the order). */
export const orderIdOf = {
  teams: (t: SiteHomeData['teams'][number]) => t.id,
  staff: (s: SiteHomeData['staff'][number]) => s.name,
  venues: (v: SiteHomeData['venues'][number]) => v.id,
  affiliations: (a: SiteHomeData['affiliations'][number]) => a.name,
  courses: (c: SiteHomeData['courses'][number]) => c.course.id,
  divisions: (d: SiteHomeData['divisions'][number]) => `${d.seasonLabel}:${d.divisionName}`,
  documents: (doc: { title: string }) => doc.title,
  news: (post: NonNullable<SiteHomeData['news']>[number]) => post.slug,
} as const;

/** What the panel's reorder control lists for a widget: `{id, label}` per
 *  item, in the DEFAULT order. `config` is the widget's effective config
 *  (documents live there); the data bag carries the rest. Defensive reads,
 *  no zod (the render parser re-validates at render). */
export function orderItems(key: SiteWidgetKey, data: SiteHomeData, config: Record<string, unknown>): { id: string; label: string }[] {
  switch (key) {
    case 'teams':
      return data.teams.map(t => ({ id: orderIdOf.teams(t), label: t.name }));
    case 'staff':
      return data.staff.map(s => ({ id: orderIdOf.staff(s), label: `${s.name} · ${s.role}` }));
    case 'venues':
      return data.venues.map(v => ({ id: orderIdOf.venues(v), label: v.name }));
    case 'affiliations':
      return data.affiliations.map(a => ({ id: orderIdOf.affiliations(a), label: a.name }));
    case 'courses':
      return data.courses.map(c => ({ id: orderIdOf.courses(c), label: c.course.name }));
    case 'divisions':
      return data.divisions.map(d => ({ id: orderIdOf.divisions(d), label: d.seasonLabel ? `${d.divisionName} · ${d.seasonLabel}` : d.divisionName }));
    case 'news':
      return (data.news ?? []).map(n => ({ id: orderIdOf.news(n), label: n.title }));
    case 'documents': {
      const raw = config.documents;
      if (!Array.isArray(raw)) return [];
      return raw
        .map(item => asRecord(item).title)
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map(t => ({ id: t, label: t }));
    }
    default:
      return [];
  }
}
