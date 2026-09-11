/**
 * The widget catalog — Site Builder phase 1 (Sep 9 2026).
 *
 * The closed set of things a club or league page can be composed of. Each
 * entry is a WidgetDef: what family it belongs to, how it may be sized on
 * the 12-column grid, which SURFACES it renders on (the public web site,
 * the in-app org page, or both), which home-page readers it needs, and what
 * a staff member sees when it is empty. A widget holds a QUERY, never data:
 * the definitions here describe shape and placement; resolving happens in
 * the renderers.
 *
 * ZERO IMPORTS ON PURPOSE. This file is consumed by the in-app org page
 * (a client bundle) as well as the server; `WEB_WIDGET_KEYS` is therefore a
 * literal copy of `MODULE_KEYS` in `@/lib/org-sites/validate.ts` rather
 * than an import — pulling validate.ts (971 lines + zod) into the org-page
 * chunk is exactly what we must not do. `registry.test.ts` pins the two
 * lists equal, so they cannot drift silently.
 *
 * ONE KEY SPACE for web and app. The in-app glance grid predates this
 * registry and its bubble keys are an e2e contract (`[data-org-bubble]`,
 * `ORG_BUBBLE_LABEL`), so three web widgets alias to the bubble key they
 * already answer to: schedule → events, venues → courses, gallery → photos.
 * (The app "Courses / Venues" bubble reads /venues and hosts OrgVenues, so
 * it IS the venues widget — Tom, Sep 9; the web `courses` widget is the
 * golf catalog's course pages and stays web-only.) Four widgets exist only
 * in the app today: week, announcements, activity, posts.
 *
 * "Module" and "widget" are distinct concepts: a MODULE is a route (a
 * subpage, a nav entry, the members-only policy on a private club); a
 * WIDGET is a tile on the home composition. `moduleKey` links a widget to
 * the module it belongs to; app-only widgets have none.
 *
 * CONTENT WIDGETS (phase 6): text, image, embed — tiles with no module
 * behind them (no route, no nav entry, no module row): what they show is
 * authored in the editor and rides the layout INSTANCE, under the publish
 * gate with everything else (a draft paragraph never goes live before
 * Publish; Restore brings the words back with the placement). They may
 * appear any number of times (`multiple`), render no fixed heading unless
 * the instance sets a title (`headingOptional`), and render on BOTH
 * surfaces — in-app as tiles (phase 10), never as bubbles.
 */

export type Surface = 'web' | 'app';
export type WidgetFamily = 'live' | 'content' | 'structural';
export type BubbleSpan = 'sm' | 'md' | 'lg';

/** Literal copy of validate.ts MODULE_KEYS (pinned equal by test). */
export const WEB_WIDGET_KEYS = [
  'hero',
  'standings',
  'schedule',
  'teams',
  'staff',
  'venues',
  'affiliations',
  'sponsors',
  'contact',
  'news',
  'gallery',
  'register',
  'courses',
  'divisions',
  'leaders',
  'documents',
  'members',
] as const;
export type WebWidgetKey = (typeof WEB_WIDGET_KEYS)[number];

/** Widgets the in-app org page renders that have no public-site module. */
export const APP_ONLY_WIDGET_KEYS = ['week', 'announcements', 'activity', 'posts'] as const;
export type AppOnlyWidgetKey = (typeof APP_ONLY_WIDGET_KEYS)[number];

/** Phase 6 — content widgets: authored tiles with no module behind them. */
// Program 2, D (Sep 11 2026): two FIXED forms — the instance holds the intro
// and the thank-you line; a visitor's submission lands in the site's inbox.
export const CONTENT_WIDGET_KEYS = ['text', 'image', 'embed', 'contact_form', 'interest_form'] as const;
export const FORM_WIDGET_KEYS = ['contact_form', 'interest_form'] as const;
export type FormWidgetKey = (typeof FORM_WIDGET_KEYS)[number];
export function isFormWidgetKey(key: string): key is FormWidgetKey {
  return (FORM_WIDGET_KEYS as readonly string[]).includes(key);
}
export type ContentWidgetKey = (typeof CONTENT_WIDGET_KEYS)[number];

/** Every key a SITE layout may hold (the wire schema's enum): the module-
 *  backed web widgets plus the content widgets. */
export const SITE_WIDGET_KEYS = [...WEB_WIDGET_KEYS, ...CONTENT_WIDGET_KEYS] as const;
export type SiteWidgetKey = (typeof SITE_WIDGET_KEYS)[number];

/** Program 2, B (Sep 11 2026): what a custom PAGE may hold — every site
 *  widget except the hero, which is the site's identity (it reads
 *  `hero_config`; seeds and `set_module` assume exactly one, on the home). */
export const PAGE_WIDGET_KEYS = SITE_WIDGET_KEYS.filter((k): k is Exclude<SiteWidgetKey, 'hero'> => k !== 'hero');
export type PageWidgetKey = (typeof PAGE_WIDGET_KEYS)[number];

/** Phase 9 — module widgets that may repeat, each instance bound to its own
 *  query (a competition, a venue): standings, schedule, leaders. */
export const QUERY_WIDGET_KEYS = ['standings', 'schedule', 'leaders'] as const;
export type QueryWidgetKey = (typeof QUERY_WIDGET_KEYS)[number];

export const WIDGET_KEYS = [...WEB_WIDGET_KEYS, ...CONTENT_WIDGET_KEYS, ...APP_ONLY_WIDGET_KEYS] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

export function isWidgetKey(value: unknown): value is WidgetKey {
  return typeof value === 'string' && (WIDGET_KEYS as readonly string[]).includes(value);
}
export function isWebWidgetKey(value: unknown): value is WebWidgetKey {
  return typeof value === 'string' && (WEB_WIDGET_KEYS as readonly string[]).includes(value);
}
export function isContentWidgetKey(value: unknown): value is ContentWidgetKey {
  return typeof value === 'string' && (CONTENT_WIDGET_KEYS as readonly string[]).includes(value);
}
export function isSiteWidgetKey(value: unknown): value is SiteWidgetKey {
  return typeof value === 'string' && (SITE_WIDGET_KEYS as readonly string[]).includes(value);
}

/** The in-app bubble keys — the DOM / e2e identity of an app slot. */
export type AppBubbleKey =
  | 'members'
  | 'week'
  | 'standings'
  | 'events'
  | 'news'
  | 'announcements'
  | 'courses'
  | 'activity'
  | 'affiliations'
  | 'photos'
  | 'posts';

/** The fields of the public home's `SiteHomeData` a web widget consumes —
 *  page.tsx gates its readers on these (a widget that is not on the page
 *  costs no query). */
export type SiteHomeDataKey =
  | 'standings'
  | 'events'
  | 'teams'
  | 'staff'
  | 'venues'
  | 'affiliations'
  | 'openWindows'
  | 'courses'
  | 'divisions'
  | 'leaders'
  | 'clubGolfBoards'
  | 'courseStrip'
  | 'golfRounds'
  | 'news'
  | 'memberStats';

export interface WidgetConstraints {
  minW: number;
  maxW: number;
  /** `h` is a MINIMUM height everywhere (renderer, seeds, editor): content
   *  may grow a widget, never be clipped by it. */
  minH: number;
  maxH: number;
  defaultSize: { w: number; h: number };
  /** Columns on the 2-column phone grid; mobile order derives from desktop
   *  reading order, never authored separately. */
}

export interface AppSurface {
  /** Ascending = the in-app glance order. */
  priority: number;
  /** The bubble's span token — BubbleCard maps it to literal classes. */
  size: BubbleSpan;
  /** DOM / e2e identity of the bubble (an alias when it differs from the
   *  widget key). null (phase 10) = a TILE, not a bubble: no window, its
   *  identity is the instance id (content widgets). */
  bubbleKey: AppBubbleKey | null;
  /** The widget renders its own bubble AND window (the members' posts wall). */
  ownsWindow?: true;
  /** Phase 10 — renders in-app even when the site's composition omits it
   *  (placed at its registry priority like an app-only widget), and ignores
   *  the instance's visibility: the roster window lives on `members`, and
   *  Photos shows regardless of the gallery toggle (Org Pages R4). */
  pinned?: true;
}

export interface WidgetEmptyState {
  /** What staff see at zero: the line plus the console section it links to. */
  staff: { label: string; consoleHash?: string };
  /** Empty widgets never render publicly. */
  public: 'hide';
}

export interface WidgetDef {
  key: WidgetKey;
  family: WidgetFamily;
  /** The public-site module this widget belongs to (subpage, nav, the
   *  members-only policy) — null for app-only widgets. */
  moduleKey: WebWidgetKey | null;
  constraints: WidgetConstraints;
  surfaces: { default: readonly Surface[]; app?: AppSurface };
  /** Has its own /org/{slug}/{key} page — mirrors MODULE_SUBPAGE_KEYS (pinned). */
  subpage: boolean;
  data: readonly SiteHomeDataKey[];
  emptyState?: WidgetEmptyState;
  /** Phase 6 — may appear any number of times on one layout (content
   *  widgets; phase 9: the query widgets too — each instance bound to its
   *  own competition / venue); every other module widget is one per key. */
  multiple?: true;
  /** Phase 6 — the widget's name in the picker and the panel when no
   *  module label applies (content widgets). */
  defaultTitle?: string;
  /** Phase 6 — the public frame renders a heading only when the INSTANCE
   *  sets a title (a paragraph or a photo needs none). */
  headingOptional?: true;
}

const FULL: WidgetConstraints = { minW: 6, maxW: 12, minH: 2, maxH: 12, defaultSize: { w: 12, h: 4 } };
const HALF: WidgetConstraints = { minW: 4, maxW: 12, minH: 1, maxH: 12, defaultSize: { w: 6, h: 3 } };
const TABLE: WidgetConstraints = { minW: 6, maxW: 12, minH: 2, maxH: 12, defaultSize: { w: 6, h: 4 } };
/** App-only widgets have no web placement yet; they still carry sane bounds. */
const APP: WidgetConstraints = { minW: 4, maxW: 12, minH: 1, maxH: 12, defaultSize: { w: 6, h: 3 } };

const BOTH: readonly Surface[] = ['web', 'app'];
const WEB: readonly Surface[] = ['web'];
const APP_ONLY: readonly Surface[] = ['app'];

export const WIDGETS: Readonly<Record<WidgetKey, WidgetDef>> = {
  hero: {
    key: 'hero',
    family: 'structural',
    moduleKey: 'hero',
    // A1 (Sep 11 2026): default 4 rows so the canvas preview shows the CTA row; `h` stays a MINIMUM publicly.
    constraints: { minW: 12, maxW: 12, minH: 2, maxH: 6, defaultSize: { w: 12, h: 4 } },
    surfaces: { default: WEB },
    subpage: false,
    data: [],
  },
  members: {
    key: 'members',
    family: 'live',
    moduleKey: 'members',
    constraints: TABLE,
    surfaces: { default: BOTH, app: { priority: 10, size: 'sm', bubbleKey: 'members', pinned: true } },
    subpage: true,
    data: ['memberStats'],
  },
  week: {
    key: 'week',
    family: 'live',
    moduleKey: null,
    constraints: APP,
    surfaces: { default: APP_ONLY, app: { priority: 20, size: 'md', bubbleKey: 'week' } },
    subpage: false,
    data: [],
  },
  standings: {
    key: 'standings',
    family: 'live',
    moduleKey: 'standings',
    constraints: TABLE,
    surfaces: { default: BOTH, app: { priority: 30, size: 'md', bubbleKey: 'standings' } },
    subpage: true,
    multiple: true,
    data: ['standings'],
    emptyState: { staff: { label: 'Set up a competition →', consoleHash: '#competitions' }, public: 'hide' },
  },
  schedule: {
    key: 'schedule',
    family: 'live',
    moduleKey: 'schedule',
    constraints: HALF,
    surfaces: { default: BOTH, app: { priority: 40, size: 'sm', bubbleKey: 'events' } },
    subpage: true,
    multiple: true,
    data: ['events', 'golfRounds'],
    emptyState: { staff: { label: 'Add an event →', consoleHash: '#competitions' }, public: 'hide' },
  },
  news: {
    key: 'news',
    family: 'content',
    moduleKey: 'news',
    constraints: FULL,
    surfaces: { default: BOTH, app: { priority: 50, size: 'sm', bubbleKey: 'news' } },
    subpage: true,
    data: ['news'],
    emptyState: { staff: { label: 'Post news →', consoleHash: '#website' }, public: 'hide' },
  },
  announcements: {
    key: 'announcements',
    family: 'live',
    moduleKey: null,
    constraints: APP,
    surfaces: { default: APP_ONLY, app: { priority: 60, size: 'sm', bubbleKey: 'announcements' } },
    subpage: false,
    data: [],
    emptyState: { staff: { label: 'Announce →', consoleHash: '#roster' }, public: 'hide' },
  },
  venues: {
    key: 'venues',
    family: 'live',
    moduleKey: 'venues',
    constraints: HALF,
    surfaces: { default: BOTH, app: { priority: 70, size: 'sm', bubbleKey: 'courses' } },
    subpage: false,
    data: ['venues'],
    emptyState: { staff: { label: 'Add a venue →', consoleHash: '#venues' }, public: 'hide' },
  },
  activity: {
    key: 'activity',
    family: 'live',
    moduleKey: null,
    constraints: APP,
    surfaces: { default: APP_ONLY, app: { priority: 80, size: 'sm', bubbleKey: 'activity' } },
    subpage: false,
    data: [],
  },
  gallery: {
    key: 'gallery',
    family: 'content',
    moduleKey: 'gallery',
    constraints: FULL,
    surfaces: { default: BOTH, app: { priority: 90, size: 'md', bubbleKey: 'photos', pinned: true } },
    subpage: true,
    data: [],
  },
  affiliations: {
    key: 'affiliations',
    family: 'live',
    moduleKey: 'affiliations',
    constraints: HALF,
    surfaces: { default: BOTH, app: { priority: 100, size: 'sm', bubbleKey: 'affiliations' } },
    subpage: false,
    data: ['affiliations'],
  },
  posts: {
    key: 'posts',
    family: 'live',
    moduleKey: null,
    constraints: { ...APP, defaultSize: { w: 12, h: 4 } },
    surfaces: { default: APP_ONLY, app: { priority: 110, size: 'lg', bubbleKey: 'posts', ownsWindow: true } },
    subpage: false,
    data: [],
  },
  teams: {
    key: 'teams',
    family: 'live',
    moduleKey: 'teams',
    constraints: FULL,
    surfaces: { default: WEB },
    subpage: true,
    data: ['teams'],
  },
  staff: {
    key: 'staff',
    family: 'live',
    moduleKey: 'staff',
    constraints: HALF,
    surfaces: { default: WEB },
    subpage: false,
    data: ['staff'],
  },
  sponsors: {
    key: 'sponsors',
    family: 'content',
    moduleKey: 'sponsors',
    constraints: HALF,
    surfaces: { default: WEB },
    subpage: false,
    data: [],
  },
  contact: {
    key: 'contact',
    family: 'content',
    moduleKey: 'contact',
    constraints: HALF,
    surfaces: { default: WEB },
    subpage: false,
    data: [],
  },
  register: {
    key: 'register',
    family: 'live',
    moduleKey: 'register',
    constraints: HALF,
    surfaces: { default: WEB },
    subpage: false,
    data: ['openWindows'],
  },
  courses: {
    key: 'courses',
    family: 'live',
    moduleKey: 'courses',
    constraints: FULL,
    surfaces: { default: WEB },
    subpage: true,
    data: ['courses', 'clubGolfBoards', 'courseStrip'],
  },
  divisions: {
    key: 'divisions',
    family: 'live',
    moduleKey: 'divisions',
    constraints: HALF,
    surfaces: { default: WEB },
    subpage: true,
    data: ['divisions'],
  },
  leaders: {
    key: 'leaders',
    family: 'live',
    moduleKey: 'leaders',
    constraints: { ...FULL, defaultSize: { w: 12, h: 4 } },
    surfaces: { default: WEB },
    subpage: true,
    data: ['leaders'],
    multiple: true,
  },
  documents: {
    key: 'documents',
    family: 'content',
    moduleKey: 'documents',
    constraints: HALF,
    surfaces: { default: WEB },
    subpage: true,
    data: [],
  },
  // ── Content widgets (phase 6) — authored on the instance, under the gate ──
  text: {
    key: 'text',
    family: 'content',
    moduleKey: null,
    constraints: { minW: 4, maxW: 12, minH: 1, maxH: 20, defaultSize: { w: 6, h: 3 } },
    // Phase 10: in-app too — a TILE where the manager placed it (no window;
    // priority unused: position comes from the layout).
    surfaces: { default: BOTH, app: { priority: 0, size: 'md', bubbleKey: null } },
    subpage: false,
    data: [],
    multiple: true,
    defaultTitle: 'Text',
    headingOptional: true,
    emptyState: { staff: { label: 'Write something →' }, public: 'hide' },
  },
  image: {
    key: 'image',
    family: 'content',
    moduleKey: null,
    constraints: { minW: 3, maxW: 12, minH: 2, maxH: 20, defaultSize: { w: 6, h: 4 } },
    // Phase 10: in-app too — a TILE where the manager placed it (no window;
    // priority unused: position comes from the layout).
    surfaces: { default: BOTH, app: { priority: 0, size: 'md', bubbleKey: null } },
    subpage: false,
    data: [],
    multiple: true,
    defaultTitle: 'Image',
    headingOptional: true,
    emptyState: { staff: { label: 'Add a photo →' }, public: 'hide' },
  },
  contact_form: {
    key: 'contact_form',
    family: 'content',
    moduleKey: null,
    constraints: { minW: 4, maxW: 12, minH: 3, maxH: 20, defaultSize: { w: 6, h: 6 } },
    surfaces: { default: BOTH, app: { priority: 0, size: 'md', bubbleKey: null } },
    subpage: false,
    data: [],
    multiple: true,
    defaultTitle: 'Contact us',
    headingOptional: true,
    emptyState: { staff: { label: 'Write an intro →' }, public: 'hide' },
  },
  interest_form: {
    key: 'interest_form',
    family: 'content',
    moduleKey: null,
    constraints: { minW: 4, maxW: 12, minH: 3, maxH: 20, defaultSize: { w: 6, h: 7 } },
    surfaces: { default: BOTH, app: { priority: 0, size: 'md', bubbleKey: null } },
    subpage: false,
    data: [],
    multiple: true,
    defaultTitle: 'Interested in joining?',
    headingOptional: true,
    emptyState: { staff: { label: 'Write an intro →' }, public: 'hide' },
  },
  embed: {
    key: 'embed',
    family: 'content',
    moduleKey: null,
    constraints: { minW: 6, maxW: 12, minH: 3, maxH: 20, defaultSize: { w: 12, h: 6 } },
    // Phase 10: in-app too — a TILE where the manager placed it (no window;
    // priority unused: position comes from the layout).
    surfaces: { default: BOTH, app: { priority: 0, size: 'md', bubbleKey: null } },
    subpage: false,
    data: [],
    multiple: true,
    defaultTitle: 'Embed',
    headingOptional: true,
    emptyState: { staff: { label: 'Paste a YouTube, Vimeo or OpenStreetMap link →' }, public: 'hide' },
  },
};

export function widgetDef(key: WidgetKey): WidgetDef {
  return WIDGETS[key];
}
