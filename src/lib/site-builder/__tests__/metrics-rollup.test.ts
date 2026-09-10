import { describe, expect, it } from 'vitest';
import { ONE_HOUR_SECONDS, percentile, rollupSiteMetrics, type MetricsRevisionRow, type MetricsSiteRow } from '../metrics-rollup';
import { STATS_VERSION } from '../metrics';

// Phase 11: the roll-up the admin dashboard shows — pure over plain rows.

const NOW = '2026-09-09T12:00:00.000Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const site = (id: string, o: Partial<MetricsSiteRow> = {}): MetricsSiteRow => ({
  id,
  created_at: daysAgo(40),
  published_at: null,
  template_id: 'classic',
  draft_revision_id: null,
  published_revision_id: null,
  ...o,
});
const stats = (o: Record<string, unknown>) => ({
  v: STATS_VERSION,
  widgetCount: 7,
  widgetsTouched: 3,
  added: [],
  removed: [],
  firstPublish: false,
  secondsSinceDraft: 100,
  secondsSinceSiteCreated: 5000,
  ...o,
});
const rev = (id: string, site_id: string, published_at: string | null, s: unknown): MetricsRevisionRow => ({ id, site_id, published_at, stats: s });

describe('percentile (nearest rank)', () => {
  it('odd, even, single, empty', () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3);
    expect(percentile([9], 0.5)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });
});

describe('rollupSiteMetrics', () => {
  it('empty in → zeros and nulls out', () => {
    const m = rollupSiteMetrics([], [], NOW, false);
    expect(m.sites).toEqual({ total: 0, live: 0, withDraft: 0, withPublishedRevision: 0, createdLast7: 0, createdLast30: 0, byTemplate: {} });
    expect(m.publishes).toEqual({ total: 0, last7: 0, last30: 0, sitesPublishedLast30: 0 });
    expect(m.firstPublish).toEqual({ count: 0, withinHour: 0, medianSeconds: null, p75Seconds: null, medianWidgetsTouched: null });
    expect(m.editor).toEqual({ sitesWithLayout: 0, adoptionRate: null, medianWidgetCount: null, topAdded: [] });
    expect(m.truncated).toBe(false);
  });

  it('counts sites, windows, templates, publishes; the one-hour boundary is inclusive; junk stats skipped but still publishes', () => {
    const sites = [
      site('a', { created_at: daysAgo(1), published_at: daysAgo(1), template_id: 'bold', draft_revision_id: 'd1', published_revision_id: 'p1' }),
      site('b', { created_at: daysAgo(10), published_revision_id: 'p2' }),
      site('c', { created_at: daysAgo(40), draft_revision_id: 'd3' }),
      site('d', { created_at: daysAgo(2), template_id: 'bold' }),
    ];
    const revisions = [
      rev('p1', 'a', daysAgo(1), stats({ firstPublish: true, secondsSinceSiteCreated: ONE_HOUR_SECONDS, widgetsTouched: 4, added: ['text', 'embed'], widgetCount: 9 })),
      rev('p1b', 'a', daysAgo(0.5), stats({ added: ['text'], widgetCount: 10 })),
      rev('p2', 'b', daysAgo(9), stats({ firstPublish: true, secondsSinceSiteCreated: ONE_HOUR_SECONDS + 1, widgetsTouched: 8, widgetCount: null })),
      rev('p2b', 'b', daysAgo(20), { v: 99, junk: true }),
      rev('p3', 'c', daysAgo(31), stats({ firstPublish: true, secondsSinceSiteCreated: 120, widgetsTouched: 1, added: ['leaders'] })),
      rev('draft', 'c', null, stats({})),
    ];
    const m = rollupSiteMetrics(sites, revisions, NOW, true);
    expect(m.sites).toEqual({ total: 4, live: 1, withDraft: 2, withPublishedRevision: 2, createdLast7: 2, createdLast30: 3, byTemplate: { classic: 2, bold: 2 } });
    expect(m.publishes).toEqual({ total: 5, last7: 2, last30: 4, sitesPublishedLast30: 2 });
    // Three first publishes: 3600 (inside), 3601 (outside), 120 (inside).
    expect(m.firstPublish).toEqual({ count: 3, withinHour: 2, medianSeconds: ONE_HOUR_SECONDS, p75Seconds: ONE_HOUR_SECONDS + 1, medianWidgetsTouched: 4 });
    // Adoption = LATEST published revision per site with a stored layout: a (10 — the later one, not 9), c (7); b's latest is null.
    expect(m.editor.sitesWithLayout).toBe(2);
    expect(m.editor.adoptionRate).toBe(1); // 2 / withPublishedRevision (2) — c has no pointer but a published row; rate is capped by construction at the rows
    expect(m.editor.medianWidgetCount).toBe(7);
    expect(m.editor.topAdded).toEqual([
      { key: 'text', count: 2 },
      { key: 'embed', count: 1 },
      { key: 'leaders', count: 1 },
    ]);
    expect(m.truncated).toBe(true);
  });

  it('a bad `now` falls back to the clock; unparsable dates never count in a window', () => {
    const m = rollupSiteMetrics([site('x', { created_at: 'nope' })], [rev('r', 'x', 'garbage', stats({}))], 'not-a-date', false);
    expect(m.sites.createdLast30).toBe(0);
    expect(m.publishes.total).toBe(1);
    expect(m.publishes.last30).toBe(0);
  });
});
