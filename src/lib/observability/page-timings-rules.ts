/**
 * Real-user page timings — the RULES (performance program Phase 0.4, Nov 2026).
 * Pure, zero imports; the beacon (components/observability/PageTimingBeacon.tsx),
 * the writer (app/api/page-timings/route.ts) and the reader (page-timings-server.ts)
 * apply them; src/lib/__tests__/page-timings-rules.test.ts pins them.
 *
 * A row is a number about a BUILD, never about a person: no id, no IP, no
 * user agent — the build, a route with its ids masked, the metric, its
 * value, the browser's rating, a device class from the viewport, and how
 * the page was reached. Thirty days, then gone.
 */

export const TIMING_METRICS = ['LCP', 'INP', 'CLS', 'TTFB', 'FCP'] as const;
export type TimingMetric = (typeof TIMING_METRICS)[number];
export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/** One beacon carries at most this many metrics (a page reports ~5). */
export const MAX_ROWS_PER_BEACON = 10;
/** A value past this is a broken clock, not a measurement (ms; CLS is unitless and tiny). */
export const MAX_VALUE = 120_000;
/** The table keeps this many days (the daily cron prunes). */
export const TIMINGS_RETENTION_DAYS = 30;
/** How long the beacon batches metrics before sending (ms). */
export const BEACON_BATCH_MS = 2_000;

export interface TimingRow {
  build: string;
  route: string;
  metric: TimingMetric;
  value: number;
  rating: string | null;
  device: DeviceClass;
  navigation: string | null;
  signed_in: boolean;
}

/** The viewport decides the class — never the user agent. */
export function deviceClass(viewportWidth: number): DeviceClass {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 'desktop';
  if (viewportWidth < 640) return 'phone';
  if (viewportWidth < 1024) return 'tablet';
  return 'desktop';
}

/** `/athlete/3f9b…` → `/athlete/:id`; `/u/jane` → `/u/:handle`; a query never counts. */
export function maskRoute(pathname: string): string {
  const path = pathname.split('?')[0].split('#')[0] || '/';
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/^\/u\/[^/]+/, '/u/:handle')
    .replace(/^\/(org|league|club)\/[^/]+/, '/$1/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 120);
}

/** A build tag: letters, digits, `-` and `_`, at most 40 — the service worker's rule, repeated. */
export function cleanBuild(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return clean || null;
}

/**
 * The beacon's body → rows, or null when the body is not a page timings payload.
 * Each row is checked field by field; a bad row is dropped, never the batch.
 */
export function readPageTimingsPayload(body: unknown, signedIn: boolean): TimingRow[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { build?: unknown; route?: unknown; device?: unknown; navigation?: unknown; metrics?: unknown };
  const build = cleanBuild(b.build);
  if (!build || typeof b.route !== 'string' || !Array.isArray(b.metrics)) return null;
  const route = maskRoute(b.route);
  const device: DeviceClass = b.device === 'phone' || b.device === 'tablet' || b.device === 'desktop' ? b.device : 'desktop';
  const navigation = typeof b.navigation === 'string' ? b.navigation.slice(0, 24) : null;
  const rows: TimingRow[] = [];
  for (const m of b.metrics.slice(0, MAX_ROWS_PER_BEACON)) {
    if (!m || typeof m !== 'object') continue;
    const { name, value, rating } = m as { name?: unknown; value?: unknown; rating?: unknown };
    if (typeof name !== 'string' || !(TIMING_METRICS as readonly string[]).includes(name)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_VALUE) continue;
    rows.push({
      build,
      route,
      metric: name as TimingMetric,
      value: Math.round(value * 1000) / 1000,
      rating: typeof rating === 'string' ? rating.slice(0, 24) : null,
      device,
      navigation,
      signed_in: signedIn,
    });
  }
  return rows;
}

/** The 75th percentile, the number the browser timing thresholds are written for. */
export function p75(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1)];
}

export interface BuildSummary {
  build: string;
  samples: number;
  /** p75 per metric per device class, ms (CLS unitless). */
  p75: Record<DeviceClass, Partial<Record<TimingMetric, number>>>;
  firstSeen: string;
  lastSeen: string;
}

/** Rows → one summary per build, newest build (by last sample) first. */
export function summarizeByBuild(rows: ReadonlyArray<TimingRow & { received_at: string }>, maxBuilds = 10): BuildSummary[] {
  const byBuild = new Map<string, { rows: Array<TimingRow & { received_at: string }>; first: string; last: string }>();
  for (const r of rows) {
    const b = byBuild.get(r.build) ?? { rows: [], first: r.received_at, last: r.received_at };
    b.rows.push(r);
    if (r.received_at < b.first) b.first = r.received_at;
    if (r.received_at > b.last) b.last = r.received_at;
    byBuild.set(r.build, b);
  }
  return [...byBuild.entries()]
    .sort((a, b) => (a[1].last < b[1].last ? 1 : -1))
    .slice(0, maxBuilds)
    .map(([build, b]) => {
      const out: BuildSummary['p75'] = { phone: {}, tablet: {}, desktop: {} };
      for (const device of ['phone', 'tablet', 'desktop'] as const) {
        for (const metric of TIMING_METRICS) {
          const v = p75(b.rows.filter((r) => r.device === device && r.metric === metric).map((r) => r.value));
          if (v !== null) out[device][metric] = v;
        }
      }
      return { build, samples: b.rows.length, p75: out, firstSeen: b.first, lastSeen: b.last };
    });
}
