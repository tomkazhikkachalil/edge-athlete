'use client';

import { Star, Camera } from 'lucide-react';
import VitalsOverlay from './VitalsOverlay';
import { parseDateLocal } from '@/lib/formatters';
import { categoryAccent, metricCategory } from './category-colors';
import { computeMetricStats, formatEntryValue, type VitalEntry } from './metric-stats';
import { VITAL_CATEGORIES, getAgeAtDate } from '@/lib/vitals-config';

/**
 * The "larger window" behind a metric bubble: the full story of one metric —
 * headline stats, then the year-grouped history that used to live inline in
 * the old MetricCard's expand panel (moved verbatim; dates now parse via
 * parseDateLocal so a DATE-column value can't render the previous day, or
 * group a Jan 1 entry under the prior year).
 */

interface MetricDetailOverlayProps {
  metricKey: string;
  entries: VitalEntry[];
  athleteBirthday: string | null;
  onOpenPost: (postId: string) => void;
  onClose: () => void;
}

export default function MetricDetailOverlay({
  metricKey, entries, athleteBirthday, onOpenPost, onClose,
}: MetricDetailOverlayProps) {
  const stats = computeMetricStats(metricKey, entries);
  if (!stats) return null;
  const { metric, sorted, first, latest, best, isCurrentBest, deltaText, deltaGood, yearsTracked } = stats;
  const category = metricCategory(metricKey);
  const accent = categoryAccent(category);
  const categoryLabel = VITAL_CATEGORIES.find(c => c.key === category)?.label;

  // History grouped by (local) year, newest first
  const byYear: Record<string, VitalEntry[]> = {};
  for (const e of [...sorted].reverse()) {
    const year = String(parseDateLocal(e.recorded_at).getFullYear());
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(e);
  }
  const years = Object.keys(byYear).sort((a, b) => parseInt(b) - parseInt(a));
  const oldestYear = years[years.length - 1];

  return (
    <VitalsOverlay
      title={metric.label}
      subtitle={categoryLabel ? `${categoryLabel} · ${metric.unit}` : metric.unit}
      onClose={onClose}
    >
      {/* Headline */}
      <div className="rounded-2xl bg-surface-muted p-4 sm:p-5 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-3xl sm:text-4xl font-bold text-primary tabular-nums">
            {formatEntryValue(latest)}
          </span>
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
        </div>
        <div className="text-xs text-muted mt-1">
          {parseDateLocal(latest.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>

        {sorted.length >= 2 && (
          <div className="text-xs text-muted mt-3">
            First: <span className="font-medium">{formatEntryValue(first)}</span>
            {athleteBirthday && (
              <span className="text-faint ml-1">· {getAgeAtDate(athleteBirthday, first.recorded_at)}</span>
            )}
            {deltaText && (
              <span className={`ml-2 font-medium ${
                deltaGood === null ? 'text-tertiary' : deltaGood ? 'text-emerald-600' : 'text-red-500'
              }`}>{deltaText}</span>
            )}
          </div>
        )}
        {yearsTracked && <div className="text-xs text-faint mt-0.5">{yearsTracked}</div>}
      </div>

      {/* History */}
      <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">History</p>
      {years.map(year => (
        <div key={year} className="mb-4 last:mb-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-bold ${accent.text}`}>{year}</span>
            {year === oldestYear && <span className="text-xs text-faint">· First recorded</span>}
          </div>
          <div className="space-y-2">
            {byYear[year].map(entry => (
              <div key={entry.id} className="flex items-start justify-between text-sm py-2 px-3 bg-surface rounded-xl border border-border-subtle">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-primary">{formatEntryValue(entry)}</span>
                    {entry.id === best.id && (
                      <span className="text-xs text-amber-600 font-medium">
                        <Star className="w-2.5 h-2.5 text-amber-500 inline mr-0.5" aria-hidden="true" />PB
                      </span>
                    )}
                    {athleteBirthday && (
                      <span className="text-xs text-faint">{getAgeAtDate(athleteBirthday, entry.recorded_at)}</span>
                    )}
                    {entry.source !== 'manual' && (
                      <span className="text-xs text-violet-500">{entry.source}</span>
                    )}
                  </div>
                  {entry.notes && (
                    <p className="text-xs text-muted mt-0.5 truncate">{entry.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="text-xs text-faint">
                    {parseDateLocal(entry.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  {entry.linked_post_id && (
                    <button
                      type="button"
                      onClick={() => onOpenPost(entry.linked_post_id!)}
                      className="text-violet-500 hover:text-brand-fg-strong transition-colors"
                      title="View media post"
                    >
                      <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </VitalsOverlay>
  );
}
