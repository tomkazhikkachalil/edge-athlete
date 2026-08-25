/**
 * Shared presentation math for one metric's entry history — extracted from
 * the old VitalsTab MetricCard so the bubble card and its detail overlay
 * derive identical numbers. Pure formatting/derivation only; nothing here
 * writes or re-detects PRs.
 */

import {
  VITAL_METRICS_MAP,
  getVitalDisplayValue,
  getYearsTracked,
  getTrendArrow,
  formatSecondsToDisplay,
  type VitalMetricConfig,
} from '@/lib/vitals-config';

export interface VitalEntry {
  id: string;
  profile_id: string;
  metric_key: string;
  metric_category: string;
  metric_label: string;
  value: number | null;
  value_display: string | null;
  unit: string;
  notes: string | null;
  source: string;
  recorded_at: string;
  created_at: string;
  linked_post_id: string | null;
}

export function formatEntryValue(entry: VitalEntry): string {
  const metric = VITAL_METRICS_MAP[entry.metric_key];
  if (!metric) return getVitalDisplayValue(entry.value, entry.value_display, entry.unit);

  if (entry.value_display) return entry.value_display;
  if (entry.value === null || entry.value === undefined) return '—';

  if (metric.time_format === 'mm:ss') {
    return formatSecondsToDisplay(entry.value, 'mm:ss');
  }
  if (metric.time_format === 'decimal_seconds') {
    return `${entry.value} sec`;
  }
  return `${entry.value} ${entry.unit}`;
}

export function isBetter(a: number, b: number, lowerIsBetter: boolean | null): boolean {
  if (lowerIsBetter === null) return false;
  return lowerIsBetter ? a < b : a > b;
}

export interface MetricStats {
  metric: VitalMetricConfig;
  /** Chronological, oldest first. */
  sorted: VitalEntry[];
  first: VitalEntry;
  latest: VitalEntry;
  best: VitalEntry;
  isCurrentBest: boolean;
  /** e.g. "+40 lbs since first recorded"; null when flat or single entry. */
  deltaText: string | null;
  /** Good/bad coloring for deltaText; null when direction has no meaning. */
  deltaGood: boolean | null;
  yearsTracked: string | null;
  trend: string;
}

export function computeMetricStats(metricKey: string, entries: VitalEntry[]): MetricStats | null {
  const metric = VITAL_METRICS_MAP[metricKey];
  if (!metric || entries.length === 0) return null;

  const sorted = [...entries].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];

  let best = sorted[0];
  for (const e of sorted) {
    if (e.value !== null && best.value !== null && isBetter(e.value, best.value, metric.lower_is_better)) {
      best = e;
    }
  }

  const isCurrentBest = best.id === latest.id;

  let deltaText: string | null = null;
  let deltaGood: boolean | null = null;
  if (
    sorted.length >= 2 &&
    first.value !== null &&
    latest.value !== null &&
    metric.lower_is_better !== null
  ) {
    const diff = latest.value - first.value;
    if (diff !== 0) {
      const sign = diff > 0 ? '+' : '';
      if (metric.time_format === 'mm:ss') {
        const absDiff = Math.abs(diff);
        const mins = Math.floor(absDiff / 60);
        const secs = Math.round(absDiff % 60);
        const formatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        deltaText = `${diff < 0 ? '-' : '+'}${formatted} since first recorded`;
      } else if (metric.time_format === 'decimal_seconds') {
        deltaText = `${sign}${diff.toFixed(2)} sec since first recorded`;
      } else {
        deltaText = `${sign}${diff} ${metric.unit} since first recorded`;
      }
      deltaGood = (latest.value < first.value) === metric.lower_is_better;
    }
  }

  const yearsTracked =
    sorted.length >= 2 ? getYearsTracked(first.recorded_at, latest.recorded_at) : null;
  const trend = getTrendArrow(first.value, latest.value, metric.lower_is_better);

  return { metric, sorted, first, latest, best, isCurrentBest, deltaText, deltaGood, yearsTracked, trend };
}
