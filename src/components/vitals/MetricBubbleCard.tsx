'use client';

import { Star, ChevronRight } from 'lucide-react';
import { parseDateLocal } from '@/lib/formatters';
import { categoryAccent, metricCategory } from './category-colors';
import { computeMetricStats, formatEntryValue, type VitalEntry } from './metric-stats';

/**
 * One metric in the library grid — the compact face of the old MetricCard.
 * The whole bubble is a button; history and the fine print live in
 * MetricDetailOverlay. Accessible name stays the metric label (e2e contract:
 * getByRole('button', { name: /Bench Press/ })).
 */

interface MetricBubbleCardProps {
  metricKey: string;
  entries: VitalEntry[];
  staggerIndex?: number;
  onOpen: () => void;
}

export default function MetricBubbleCard({ metricKey, entries, staggerIndex = 0, onOpen }: MetricBubbleCardProps) {
  const stats = computeMetricStats(metricKey, entries);
  if (!stats) return null;
  const { metric, latest, best, isCurrentBest, trend } = stats;
  // VitalMetricConfig carries no category field — the lookup owns that map.
  const accent = categoryAccent(metricCategory(metricKey));
  const trendColor = trend === '▲' ? 'text-emerald-600' : trend === '▼' ? 'text-red-500' : 'text-faint';

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(staggerIndex, 10) * 40}ms` }}
      className="vt-card vt-pop-in ea-interactive w-full text-left p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-semibold ${accent.text} truncate`}>{metric.label}</span>
          <span className="text-xs text-faint shrink-0">{metric.unit}</span>
          {trend !== '—' && <span className={`text-xs font-bold ${trendColor}`}>{trend}</span>}
        </div>
        <ChevronRight className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
      </div>

      <div className="text-2xl sm:text-3xl font-bold text-primary tabular-nums mb-1.5">
        {formatEntryValue(latest)}
      </div>

      {isCurrentBest ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 rounded-full">
          <Star className="w-2.5 h-2.5 text-amber-500" aria-hidden="true" />
          Personal Best
        </span>
      ) : best.value !== null && (
        <span className="text-xs text-muted">
          PB: <span className="font-semibold">{formatEntryValue(best)}</span>
          <span className="text-faint ml-1">
            ({parseDateLocal(best.recorded_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})
          </span>
        </span>
      )}

      <div className="text-xs text-faint mt-1.5">
        {parseDateLocal(latest.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </button>
  );
}
