/**
 * The in-app surface, derived — Site Builder phase 1 (Sep 9 2026), driven
 * by the site's COMPOSITION since phase 10.
 *
 * The design doc: the admin composes ONE layout (the web site); the app
 * page is generated from it — the app-capable instances in READING ORDER,
 * their titles, later their content tiles — with the app-only widgets
 * (week, announcements, activity, posts) and the PINNED ones (members,
 * gallery — Org Pages R4: Photos shows regardless of the gallery toggle)
 * interleaved at their registry priority. An org with no site or no stored
 * layout keeps the registry order exactly (`deriveAppLayout()` with no
 * composition is the recorded Sep 9 glance order, pinned by test) — zero
 * visual change for every org until its manager arranges the page.
 *
 * CLIENT-SAFE: no zod, no validate.ts (this module reaches the org-page
 * chunk). The composition's content is RESOLVED on the server
 * (`app-composition.ts`) into the plain wire shapes below.
 */

import { WIDGETS, WIDGET_KEYS, isContentWidgetKey, type AppBubbleKey, type BubbleSpan, type WidgetKey } from './catalog';
import { effectiveAudience, type AudienceSite } from './audience';
import { instanceTitle } from './config';
import { deriveMobileOrder, type SiteLayout, type WidgetVisibility } from './layout';
import type { PageBlock } from '@/lib/org-sites/validate';

/** A content tile resolved for the app (phase 10-B fills these). */
export type AppTile =
  | { kind: 'text'; blocks: PageBlock[] }
  | { kind: 'image'; src: string; alt: string; caption: string | null; href: string | null; width: number; height: number }
  | { kind: 'embed'; src: string; title: string; provider: string }
  /** Program 2, D: a form tile in-app is a door to the public form (no form in-app). */
  | { kind: 'form'; form: 'contact' | 'interest'; intro: string | null; href: string | null };

/** One app-capable instance of the composition, in reading order. */
export interface AppInstance {
  id: string;
  key: WidgetKey;
  w: number;
  title: string | null;
  visibility: WidgetVisibility;
  tile?: AppTile;
}

/** What the org GET carries: the app-capable instances in reading order,
 *  already pruned to the viewer. null = no site / no stored layout. */
export interface AppComposition {
  widgets: AppInstance[];
}

export interface AppSlot {
  key: WidgetKey;
  /** null = a content TILE (no window; identity = instanceId). */
  bubbleKey: AppBubbleKey | null;
  span: BubbleSpan;
  priority: number;
  ownsWindow: boolean;
  /** The layout instance behind the slot (null for a registry-placed slot). */
  instanceId: string | null;
  /** The instance's title override, if any (the bubble's label + window title). */
  title: string | null;
  tile?: AppTile;
}

/** The registry's own order (ascending priority) — the fallback, and the
 *  source of the app-only + pinned slots the composition interleaves. */
function registrySlots(): AppSlot[] {
  const slots: AppSlot[] = [];
  for (const key of WIDGET_KEYS) {
    const app = WIDGETS[key].surfaces.app;
    // Content tiles exist only as INSTANCES of a composition — never in the
    // registry order (the recorded Sep 9 glance order stays exact).
    if (!app || isContentWidgetKey(key)) continue;
    slots.push({ key, bubbleKey: app.bubbleKey, span: app.size, priority: app.priority, ownsWindow: app.ownsWindow === true, instanceId: null, title: null });
  }
  return slots.sort((a, b) => a.priority - b.priority);
}

/** The layout's app-capable instances in reading order (the phone's order —
 *  deriveMobileOrder), with their titles. Content tiles pass through; the
 *  server resolves what they show. The visibility carried is the EFFECTIVE
 *  audience (H1): the org's current privacy over the stored value, so a
 *  club that went private after arranging never shows its members-only
 *  sections to an outsider in-app either. */
export function projectLayoutForApp(layout: SiteLayout, site: AudienceSite): AppInstance[] {
  return deriveMobileOrder(layout.widgets)
    .filter(w => !!WIDGETS[w.key].surfaces.app)
    .map(w => ({ id: w.id, key: w.key, w: w.w, title: instanceTitle(w), visibility: effectiveAudience(site, w) }));
}

export interface AppViewer {
  isMember: boolean;
  canManage: boolean;
}

/** The ONE visibility rule for the app: public → everyone; members → members
 *  (and managers); staff → managers. A PINNED widget ignores the instance's
 *  visibility (a private club's members count showed to outsiders before —
 *  zero delta). */
export function isVisibleTo(inst: Pick<AppInstance, 'key' | 'visibility'>, viewer: AppViewer): boolean {
  if (WIDGETS[inst.key].surfaces.app?.pinned) return true;
  switch (inst.visibility) {
    case 'public':
      return true;
    case 'members':
      return viewer.isMember || viewer.canManage;
    case 'staff':
      return viewer.canManage;
    default:
      return false;
  }
}

/** A module bubble keeps the registry's span (its face is designed for it);
 *  a content tile spans by its width — never `sm`, a paragraph in one phone
 *  column is unreadable. */
export function spanFor(inst: Pick<AppInstance, 'key' | 'w'>): BubbleSpan {
  const app = WIDGETS[inst.key].surfaces.app;
  if (isContentWidgetKey(inst.key)) return inst.w > 6 ? 'lg' : 'md';
  return app?.size ?? 'sm';
}

/** Registry → the in-app glance order (ascending priority) — OR, given the
 *  site's composition, the composition's order with the app-only and
 *  pinned widgets it lacks interleaved at their registry priority:
 *  `anchor(i)` is the registry priority of slot i (a content tile inherits
 *  the nearest preceding module slot's, so it sticks to the section it was
 *  placed after); a missing widget of priority p goes before the first slot
 *  whose anchor exceeds p. Posts (110) is always last: no module priority
 *  exceeds 100. */
export function deriveAppLayout(composition?: AppComposition | null): AppSlot[] {
  const registry = registrySlots();
  if (!composition) return registry;

  const slots: AppSlot[] = [];
  // H3: one BUBBLE per bubble key — a second standings instance (phase 9's
  // "Add another", bound to its own competition) has no per-instance read
  // in-app, so it would be the same card twice with the same DOM identity.
  // The first in reading order wins; content tiles (no bubble) all render.
  const seen = new Set<AppBubbleKey>();
  for (const inst of composition.widgets) {
    const app = WIDGETS[inst.key].surfaces.app;
    if (!app) continue;
    if (app.bubbleKey !== null) {
      if (seen.has(app.bubbleKey)) continue;
      seen.add(app.bubbleKey);
    }
    slots.push({
      key: inst.key,
      bubbleKey: app.bubbleKey,
      span: spanFor(inst),
      priority: app.priority,
      ownsWindow: app.ownsWindow === true,
      instanceId: inst.id,
      title: inst.title,
      ...(inst.tile ? { tile: inst.tile } : {}),
    });
  }
  const anchors = (): number[] => {
    let last = Number.NEGATIVE_INFINITY;
    return slots.map(s => {
      if (!isContentWidgetKey(s.key)) last = s.priority;
      return last;
    });
  };
  const present = new Set(slots.map(s => s.key));
  const missing = registry.filter(s => !present.has(s.key) && (WIDGETS[s.key].moduleKey === null || WIDGETS[s.key].surfaces.app?.pinned));
  for (const m of missing) {
    // App-only widgets have no module and no instance; pinned ones show anyway.
    if (isContentWidgetKey(m.key)) continue;
    const a = anchors();
    let idx = a.findIndex(x => x > m.priority);
    if (idx < 0) idx = slots.length;
    slots.splice(idx, 0, m);
  }
  return slots;
}

/** The bubbles whose window the glance grid hosts (deep-link `?window=`
 *  validation) — every registry app slot except the ones that own their
 *  window. Registry-derived: window identity is per bubble key. */
export type OrgWindowKey = Exclude<AppBubbleKey, 'posts'>;
export const APP_WINDOW_KEYS: readonly OrgWindowKey[] = deriveAppLayout()
  .filter(s => !s.ownsWindow && s.bubbleKey !== null)
  .map(s => s.bubbleKey as OrgWindowKey);

export function isOrgWindowKey(value: unknown): value is OrgWindowKey {
  return typeof value === 'string' && (APP_WINDOW_KEYS as readonly string[]).includes(value);
}
