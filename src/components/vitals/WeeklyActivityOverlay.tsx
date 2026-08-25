'use client';

import { useMemo } from 'react';
import VitalsOverlay from './VitalsOverlay';
import RoundedBarChart from './RoundedBarChart';
import { weeklyBars } from '@/lib/vitals/derive';
import { formatVolume, formatDuration } from '@/lib/workouts/summary';
import { parseDateLocal } from '@/lib/formatters';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/**
 * The larger window behind the Weekly Activity bubble: a 12-week view with
 * the full totals per week. Numbers only describe the athlete's own history —
 * progress framing, never comparison.
 */

interface WeeklyActivityOverlayProps {
  sessions: ServerWorkoutSession[];
  onClose: () => void;
}

const weekLabel = (weekStart: string) =>
  parseDateLocal(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function WeeklyActivityOverlay({ sessions, onClose }: WeeklyActivityOverlayProps) {
  const bars = useMemo(() => weeklyBars(sessions, 12), [sessions]);
  const trained = bars.filter(b => b.workouts > 0).length;

  return (
    <VitalsOverlay
      title="Weekly activity"
      subtitle={`Trained in ${trained} of the last 12 weeks`}
      onClose={onClose}
    >
      <div className="rounded-2xl bg-surface-muted p-4 sm:p-5 mb-5">
        <RoundedBarChart
          bars={bars.map((b, i) => ({
            // First + current only — 12 labels truncate on phones, and the
            // per-week rows below carry every date anyway.
            label: i === 0 || b.isCurrent ? weekLabel(b.weekStart) : '',
            value: b.workouts,
            highlight: b.isCurrent,
            meta: `Week of ${weekLabel(b.weekStart)} — ${b.workouts} workout${b.workouts !== 1 ? 's' : ''}`,
          }))}
          color="var(--brand-fg)"
          height={140}
          ariaLabel="Workouts per week, last 12 weeks"
          valueLabels="all"
        />
      </div>

      <div className="space-y-2">
        {[...bars].reverse().map(bar => (
          <div
            key={bar.weekStart}
            className={`flex items-center justify-between gap-3 text-sm py-2.5 px-3 rounded-xl border ${
              bar.isCurrent ? 'border-brand-soft bg-brand-soft/40' : 'border-border-subtle bg-surface'
            }`}
          >
            <span className="font-semibold text-primary whitespace-nowrap">
              {weekLabel(bar.weekStart)}
              {bar.isCurrent && <span className="ml-2 text-xs font-bold text-brand-fg">This week</span>}
            </span>
            <span className="text-xs text-muted text-right">
              {bar.workouts} workout{bar.workouts !== 1 ? 's' : ''}
              {bar.volumeLbs > 0 && <> · {formatVolume(bar.volumeLbs)}</>}
              {bar.seconds > 0 && <> · {formatDuration(bar.seconds)}</>}
            </span>
          </div>
        ))}
      </div>
    </VitalsOverlay>
  );
}
