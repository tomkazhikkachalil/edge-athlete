/**
 * The site-builder metrics roll-up — Site Builder phase 11 (Sep 9 2026).
 * "Metrics without a vendor", read back: every publish already records
 * what changed and how long it took (`metrics.ts`, the revision row's
 * `stats`); this folds the sites and their published revisions into the
 * numbers the doc asked for — does a non-technical admin build a good site
 * in under an hour? — plus adoption and usage. Pure over plain rows; the
 * admin route (`/api/admin/site-metrics`) reads and hands them over.
 *
 * Nearest-rank percentiles (no interpolation — a median of two publishes is
 * the slower one, not a number nobody measured). Junk stats (another
 * build's shape) are skipped for the stats-based measures but still count
 * as publishes.
 */

import { parsePublishStats } from './metrics';

export interface MetricsSiteRow {
  id: string;
  created_at: string;
  /** Live (the site-level publish), not the revision's. */
  published_at: string | null;
  template_id: string;
  draft_revision_id: string | null;
  published_revision_id: string | null;
}

export interface MetricsRevisionRow {
  id: string;
  site_id: string;
  published_at: string | null;
  stats: unknown;
}

export interface SiteMetrics {
  sites: {
    total: number;
    live: number;
    withDraft: number;
    withPublishedRevision: number;
    createdLast7: number;
    createdLast30: number;
    byTemplate: Record<string, number>;
  };
  publishes: {
    total: number;
    last7: number;
    last30: number;
    sitesPublishedLast30: number;
  };
  /** The one-hour question, over FIRST publishes that carry a creation delta. */
  firstPublish: {
    count: number;
    withinHour: number;
    medianSeconds: number | null;
    p75Seconds: number | null;
    medianWidgetsTouched: number | null;
  };
  editor: {
    /** Sites whose LATEST published revision carries a stored layout. */
    sitesWithLayout: number;
    /** sitesWithLayout / withPublishedRevision; null when nothing is published. */
    adoptionRate: number | null;
    medianWidgetCount: number | null;
    topAdded: { key: string; count: number }[];
  };
  /** True when a read hit its row limit — the numbers are a floor. */
  truncated: boolean;
}

export const ONE_HOUR_SECONDS = 3600;
const DAY_MS = 86_400_000;

const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
};

/** Nearest-rank percentile of a non-empty list; null for an empty one. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1];
}

export function rollupSiteMetrics(sites: readonly MetricsSiteRow[], revisions: readonly MetricsRevisionRow[], now: string, truncated: boolean): SiteMetrics {
  const nowMs = ts(now) ?? Date.now();
  const since = (days: number) => nowMs - days * DAY_MS;
  const within = (iso: string | null, days: number) => {
    const t = ts(iso);
    return t !== null && t >= since(days) && t <= nowMs;
  };

  const byTemplate: Record<string, number> = {};
  for (const s of sites) byTemplate[s.template_id] = (byTemplate[s.template_id] ?? 0) + 1;

  const published = revisions.filter(r => !!r.published_at);
  const publishedSitesLast30 = new Set(published.filter(r => within(r.published_at, 30)).map(r => r.site_id));

  // First publishes with a measured creation delta.
  const firstDeltas: number[] = [];
  const firstTouched: number[] = [];
  let withinHour = 0;
  const addedCounts = new Map<string, number>();
  const latestBySite = new Map<string, { at: number; widgetCount: number | null }>();
  for (const r of published) {
    const stats = parsePublishStats(r.stats);
    if (!stats) continue;
    for (const k of stats.added) addedCounts.set(k, (addedCounts.get(k) ?? 0) + 1);
    if (stats.firstPublish && stats.secondsSinceSiteCreated !== null) {
      firstDeltas.push(stats.secondsSinceSiteCreated);
      firstTouched.push(stats.widgetsTouched);
      if (stats.secondsSinceSiteCreated <= ONE_HOUR_SECONDS) withinHour++;
    }
    const at = ts(r.published_at) ?? 0;
    const prev = latestBySite.get(r.site_id);
    if (!prev || at > prev.at) latestBySite.set(r.site_id, { at, widgetCount: stats.widgetCount });
  }
  // B1: adoption is measured over the sites actually READ (a truncated sites
  // read must not let revisions of unread sites inflate the numerator) and
  // is null while either read is truncated — a rate over a floor is not a rate.
  const siteIds = new Set(sites.map(s => s.id));
  const latestCounts = [...latestBySite.entries()].filter(([siteId]) => siteIds.has(siteId)).map(([, v]) => v.widgetCount).filter((n): n is number => n !== null);
  const withPublishedRevision = sites.filter(s => !!s.published_revision_id).length;
  const topAdded = [...addedCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 5);

  return {
    sites: {
      total: sites.length,
      live: sites.filter(s => !!s.published_at).length,
      withDraft: sites.filter(s => !!s.draft_revision_id).length,
      withPublishedRevision,
      createdLast7: sites.filter(s => within(s.created_at, 7)).length,
      createdLast30: sites.filter(s => within(s.created_at, 30)).length,
      byTemplate,
    },
    publishes: {
      total: published.length,
      last7: published.filter(r => within(r.published_at, 7)).length,
      last30: published.filter(r => within(r.published_at, 30)).length,
      sitesPublishedLast30: publishedSitesLast30.size,
    },
    firstPublish: {
      count: firstDeltas.length,
      withinHour,
      medianSeconds: percentile(firstDeltas, 0.5),
      p75Seconds: percentile(firstDeltas, 0.75),
      medianWidgetsTouched: percentile(firstTouched, 0.5),
    },
    editor: {
      sitesWithLayout: latestCounts.length,
      adoptionRate: !truncated && withPublishedRevision > 0 ? Math.min(1, Math.round((latestCounts.length / withPublishedRevision) * 1000) / 1000) : null,
      medianWidgetCount: percentile(latestCounts, 0.5),
      topAdded,
    },
    truncated,
  };
}
