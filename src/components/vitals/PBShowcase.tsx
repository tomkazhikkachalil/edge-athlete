'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Star } from 'lucide-react';
import { VITAL_METRICS_MAP, getVitalDisplayValue, formatSecondsToDisplay } from '@/lib/vitals-config';
import { EXERCISE_CATALOG } from '@/lib/workout-config';
import { categoryAccent, metricCategory } from './category-colors';
import type { VitalEntryLike } from '@/lib/workouts/dashboard';

/**
 * The trophy wall: best-ever value per metric, PR-mapped lifts first (bench,
 * squat, deadlift, OHP, pull-ups — the numbers recruiters ask about), then
 * every other non-body metric with data. Values in ink; direction-aware
 * color lives only on the delta glyph (dataviz text rule). Capped at 8 —
 * the Metrics Library below holds the rest.
 */

interface PBShowcaseProps {
  vitals: VitalEntryLike[];
}

interface ShowcaseCard {
  metricKey: string;
  label: string;
  category: string | undefined;
  bestDisplay: string;
  bestDate: string;
  /** Signed change from first-recorded to best; null when single entry. */
  improved: boolean | null;
}

const MAPPED_LIFT_KEYS: string[] = EXERCISE_CATALOG
  .map(e => e.vitalMetricKey as string | undefined)
  .filter((k): k is string => Boolean(k));

function formatValue(metricKey: string, value: number, valueDisplay?: string | null): string {
  const metric = VITAL_METRICS_MAP[metricKey];
  if (valueDisplay) return valueDisplay;
  if (metric?.time_format === 'mm:ss') return formatSecondsToDisplay(value, 'mm:ss');
  if (metric?.time_format === 'decimal_seconds') return `${value} sec`;
  return getVitalDisplayValue(value, null, metric?.unit ?? '');
}

export default function PBShowcase({ vitals }: PBShowcaseProps) {
  const cards = useMemo<ShowcaseCard[]>(() => {
    const byMetric = new Map<string, VitalEntryLike[]>();
    for (const entry of vitals) {
      if (entry.value === null) continue;
      const metric = VITAL_METRICS_MAP[entry.metric_key];
      if (!metric || metric.lower_is_better === null) continue; // body metrics aren't PRs
      if (!byMetric.has(entry.metric_key)) byMetric.set(entry.metric_key, []);
      byMetric.get(entry.metric_key)!.push(entry);
    }

    const built: ShowcaseCard[] = [];
    for (const [metricKey, entries] of byMetric) {
      const metric = VITAL_METRICS_MAP[metricKey]!;
      const sorted = [...entries].sort(
        (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      );
      const lower = metric.lower_is_better === true;
      let best = sorted[0];
      for (const entry of sorted) {
        const better = lower
          ? (entry.value as number) <= (best.value as number)
          : (entry.value as number) >= (best.value as number);
        if (better) best = entry; // ties → latest occurrence
      }
      const first = sorted[0];
      const improved =
        sorted.length < 2 || first.value === best.value
          ? sorted.length < 2 ? null : false
          : true;
      built.push({
        metricKey,
        label: metric.label,
        category: metricCategory(metricKey),
        bestDisplay: formatValue(metricKey, best.value as number, best.value_display),
        bestDate: best.recorded_at,
        improved,
      });
    }

    built.sort((a, b) => {
      const ai = MAPPED_LIFT_KEYS.indexOf(a.metricKey);
      const bi = MAPPED_LIFT_KEYS.indexOf(b.metricKey);
      const ar = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const br = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      return ar - br || a.label.localeCompare(b.label);
    });
    return built.slice(0, 8);
  }, [vitals]);

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(card => {
        const accent = categoryAccent(card.category);
        return (
          <div key={card.metricKey} className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Star className={`w-3.5 h-3.5 ${accent.text}`} aria-hidden="true" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wide truncate">
                {card.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-bold text-primary tabular-nums">{card.bestDisplay}</span>
              {card.improved === true && <TrendingUp className="w-3.5 h-3.5 text-emerald-600" aria-label="improved since first recorded" />}
              {card.improved === false && <Minus className="w-3.5 h-3.5 text-faint" aria-label="matches first recorded" />}
              {card.improved === null && <TrendingDown className="w-3.5 h-3.5 text-transparent" aria-hidden="true" />}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {new Date(card.bestDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
