/**
 * Sentry's stats, parsed (H3) — pure, ZERO imports. The organization stats
 * API (`stats_v2`, `interval=1d`, `category=error`, `outcome=accepted`)
 * answers `{ intervals: [iso…], groups: [{ series: { 'sum(quantity)': [n…] } }] }`;
 * this folds it to one count per UTC day. Anything malformed is an empty
 * list, never a throw.
 */
export interface SentryDay {
  day: string;
  count: number;
}

export function parseSentryStats(json: unknown): SentryDay[] {
  if (!json || typeof json !== 'object') return [];
  const j = json as { intervals?: unknown; groups?: unknown };
  if (!Array.isArray(j.intervals) || !Array.isArray(j.groups)) return [];
  const totals = new Map<string, number>();
  for (const g of j.groups as { series?: Record<string, unknown> }[]) {
    const series = g?.series?.['sum(quantity)'];
    if (!Array.isArray(series)) continue;
    j.intervals.forEach((iso, i) => {
      if (typeof iso !== 'string') return;
      const day = iso.slice(0, 10);
      const n = Number(series[i]);
      if (!Number.isFinite(n)) return;
      totals.set(day, (totals.get(day) ?? 0) + n);
    });
  }
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }));
}

/** The query for the last `days` days of accepted errors, one bucket a day. */
export function sentryStatsUrl(org: string, projectId: string, days: number): string {
  const q = new URLSearchParams({ project: projectId, category: 'error', outcome: 'accepted', field: 'sum(quantity)', interval: '1d', statsPeriod: `${days}d` });
  return `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/stats_v2/?${q.toString()}`;
}
