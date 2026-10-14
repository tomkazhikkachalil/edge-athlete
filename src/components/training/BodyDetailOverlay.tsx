'use client';

import { Camera } from 'lucide-react';
import TrainingOverlay from './TrainingOverlay';
import { parseDateLocal, formatHeight, formatWeightWithUnit, formatAge, formatDate } from '@/lib/formatters';
import { categoryAccent } from './category-colors';
import { formatEntryValue, type BodyMetricEntry } from './metric-stats';
import { BODY_METRIC_CATEGORIES } from '@/lib/body-metrics-config';

/**
 * The larger window behind the Body Metrics bubble: today's snapshot up top,
 * then the recorded timeline per body metric (height, weight, wingspan,
 * body fat). Body metrics have no "best" — growth isn't a competition — so
 * rows carry no PB stars by design.
 */

export interface CurrentBodyMetricsShape {
  heightCm: number | null;
  weightKg: number | null;
  weightDisplay: number | null;
  weightUnit: 'lbs' | 'kg' | 'stone' | null;
  dob: string | null;
}

interface BodyDetailOverlayProps {
  currentBodyMetrics: CurrentBodyMetricsShape | null;
  /** All entries; the overlay filters to the body category itself. */
  bodyMetrics: BodyMetricEntry[];
  isOwnProfile: boolean;
  onOpenPost: (postId: string) => void;
  onClose: () => void;
}

const BODY_METRICS = BODY_METRIC_CATEGORIES.find(c => c.key === 'body')?.metrics ?? [];

export default function BodyDetailOverlay({
  currentBodyMetrics, bodyMetrics, isOwnProfile, onOpenPost, onClose,
}: BodyDetailOverlayProps) {
  const accent = categoryAccent('body');
  const bodyEntries = bodyMetrics.filter(v => v.metric_category === 'body');

  return (
    <TrainingOverlay title="Body metrics" subtitle="Growth over time" onClose={onClose}>
      {currentBodyMetrics && (
        <div className={`grid grid-cols-2 gap-3 mb-5 ${isOwnProfile ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div className="text-center rounded-2xl bg-surface-muted p-4">
            <div className="text-xl font-bold text-primary mb-1">{formatHeight(currentBodyMetrics.heightCm)}</div>
            <div className="text-xs text-muted uppercase tracking-wide">Height</div>
          </div>
          <div className="text-center rounded-2xl bg-surface-muted p-4">
            <div className="text-xl font-bold text-primary mb-1">
              {currentBodyMetrics.weightDisplay && currentBodyMetrics.weightUnit
                ? `${currentBodyMetrics.weightDisplay} ${currentBodyMetrics.weightUnit}`
                : formatWeightWithUnit(currentBodyMetrics.weightKg, currentBodyMetrics.weightUnit)}
            </div>
            <div className="text-xs text-muted uppercase tracking-wide">Weight</div>
          </div>
          <div className="text-center rounded-2xl bg-surface-muted p-4">
            <div className="text-xl font-bold text-primary mb-1">{formatAge(currentBodyMetrics.dob)}</div>
            <div className="text-xs text-muted uppercase tracking-wide">Age</div>
          </div>
          {isOwnProfile && (
            <div className="text-center rounded-2xl bg-surface-muted p-4">
              <div className="text-xl font-bold text-primary mb-1">
                {/* T00:00:00 → LOCAL midnight; bare DATE strings parse as UTC
                    and show the previous day in the US */}
                {currentBodyMetrics.dob ? formatDate(`${currentBodyMetrics.dob.slice(0, 10)}T00:00:00`) : '—'}
              </div>
              <div className="text-xs text-muted uppercase tracking-wide">Date of Birth</div>
            </div>
          )}
        </div>
      )}

      {bodyEntries.length === 0 ? (
        <p className="text-sm text-tertiary text-center py-8">
          No body measurements recorded yet.
        </p>
      ) : (
        BODY_METRICS.map(metric => {
          const entries = bodyEntries
            .filter(e => e.metric_key === metric.key)
            .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
          if (entries.length === 0) return null;
          return (
            <div key={metric.key} className="mb-5 last:mb-0">
              <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${accent.text}`}>
                {metric.label}
              </div>
              <div className="space-y-2">
                {entries.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between text-sm py-2 px-3 bg-surface rounded-xl border border-border-subtle">
                    <span className="font-semibold text-primary">{formatEntryValue(entry)}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-faint">
                        {parseDateLocal(entry.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </TrainingOverlay>
  );
}
