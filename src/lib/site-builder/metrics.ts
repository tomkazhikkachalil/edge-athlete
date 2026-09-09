/**
 * Publish metrics — Site Builder phase 8 (Sep 9 2026). "Metrics without a
 * vendor": every publish records what changed and how long it took, in the
 * revision row's `stats` jsonb migration 180 already carries (zero DDL).
 * Pure: the diff of two layouts plus three timestamps.
 *
 * What the doc wanted to know: does a non-technical admin build a good
 * site in under an hour? `secondsSinceSiteCreated` on the FIRST publish
 * answers it per site; `widgetsTouched` / `added` / `removed` per publish
 * say how much of the builder people actually use.
 */

import type { SiteLayout, WidgetInstance } from './layout';

export const STATS_VERSION = 1;

export interface PublishStats {
  v: typeof STATS_VERSION;
  /** Widgets on the published layout (null = no stored layout: the projection). */
  widgetCount: number | null;
  /** Instances whose cell or size differs from the previous published layout. */
  widgetsTouched: number;
  /** Widget keys present now and not before (a key twice counts once). */
  added: string[];
  removed: string[];
  /** True when the site had no published revision before this one. */
  firstPublish: boolean;
  /** Draft opened → published; null when there was no draft (the rows were materialised). */
  secondsSinceDraft: number | null;
  /** Site created → this publish. */
  secondsSinceSiteCreated: number | null;
}

const cell = (w: WidgetInstance) => `${w.x},${w.y},${w.w},${w.h}`;
const seconds = (from: string | null | undefined, to: string): number | null => {
  if (!from) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
};

export function publishStats(input: {
  prev: SiteLayout | null;
  next: SiteLayout | null;
  firstPublish: boolean;
  draftCreatedAt: string | null;
  siteCreatedAt: string | null;
  now: string;
}): PublishStats {
  const prevById = new Map((input.prev?.widgets ?? []).map(w => [w.id, w]));
  const nextWidgets = input.next?.widgets ?? [];
  let touched = 0;
  for (const w of nextWidgets) {
    const p = prevById.get(w.id);
    if (!p || cell(p) !== cell(w)) touched++;
  }
  const prevKeys = new Set((input.prev?.widgets ?? []).map(w => w.key));
  const nextKeys = new Set(nextWidgets.map(w => w.key));
  return {
    v: STATS_VERSION,
    widgetCount: input.next ? nextWidgets.length : null,
    widgetsTouched: input.prev ? touched : nextWidgets.length,
    added: [...nextKeys].filter(k => !prevKeys.has(k)).sort(),
    removed: [...prevKeys].filter(k => !nextKeys.has(k)).sort(),
    firstPublish: input.firstPublish,
    secondsSinceDraft: seconds(input.draftCreatedAt, input.now),
    secondsSinceSiteCreated: seconds(input.siteCreatedAt, input.now),
  };
}

/** Defensive read of a stored `stats` (any build) — null when unusable. */
export function parsePublishStats(raw: unknown): PublishStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== STATS_VERSION) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    v: STATS_VERSION,
    widgetCount: num(r.widgetCount),
    widgetsTouched: num(r.widgetsTouched) ?? 0,
    added: strs(r.added),
    removed: strs(r.removed),
    firstPublish: r.firstPublish === true,
    secondsSinceDraft: num(r.secondsSinceDraft),
    secondsSinceSiteCreated: num(r.secondsSinceSiteCreated),
  };
}
