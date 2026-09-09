/**
 * A widget's effective config — Site Builder phase 5 (Sep 9 2026).
 *
 * Two kinds of config, two owners:
 *  • CONTENT lives on the org objects the console already writes — the
 *    hero on `hero_config`, the contact card on `contact_config`, sponsors /
 *    documents / gallery picks / course photos on their module rows (the
 *    snapshot mirrors them on publish). Nothing authored on the website
 *    lives only on the website (the doc's rule), and a stored layout must
 *    never carry a stale copy that overrides fresh content.
 *  • INSTANCE OPTIONS live on the layout instance — how THIS tile presents
 *    itself: its title override today; variants and limits later.
 *
 * `effectiveConfig` merges them with content winning on content keys. The
 * renderers (public grid, preview, canvas, picker) all read through it.
 */

import type { WidgetInstance } from './layout';
import type { WidgetKey } from './catalog';

/** The site fields a widget's content is read from (the PublicSite shape). */
export interface ContentSource {
  hero_config: unknown;
  contact_config: unknown;
  modules: { module_key: string; config: unknown }[];
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The content config the org objects hold for a widget key. */
export function contentConfigFor(site: ContentSource, key: WidgetKey): Record<string, unknown> {
  if (key === 'hero') return asRecord(site.hero_config);
  if (key === 'contact') return asRecord(site.contact_config);
  return asRecord(site.modules.find(m => m.module_key === key)?.config);
}

/** Instance options under, content on top — a stale copy on the instance
 *  can never shadow the org object. */
export function effectiveConfig(site: ContentSource, w: WidgetInstance): Record<string, unknown> {
  return { ...asRecord(w.config), ...contentConfigFor(site, w.key) };
}

export const INSTANCE_TITLE_MAX = 60;

/** The instance's own title override, if it has one. */
export function instanceTitle(w: WidgetInstance): string | null {
  const t = asRecord(w.config).title;
  return typeof t === 'string' && t.trim() ? t.trim().slice(0, INSTANCE_TITLE_MAX) : null;
}

/** Phase 9 — the instance's query (which competition / venue, how many).
 *  Read from the INSTANCE only, never through effectiveConfig: a query is
 *  an option, and content must not be able to shadow it. Defensive: a
 *  stored config from any build yields only well-formed keys. */
export interface WidgetQuery {
  competitionId?: string;
  venueId?: string;
  limit?: number;
}

export function instanceQuery(w: WidgetInstance): WidgetQuery {
  const q = asRecord(asRecord(w.config).query);
  const out: WidgetQuery = {};
  if (typeof q.competitionId === 'string' && q.competitionId) out.competitionId = q.competitionId;
  if (typeof q.venueId === 'string' && q.venueId) out.venueId = q.venueId;
  if (typeof q.limit === 'number' && Number.isInteger(q.limit) && q.limit >= 1) out.limit = q.limit;
  return out;
}
