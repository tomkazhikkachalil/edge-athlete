'use client';

import { useMemo, useState } from 'react';
import TrainingOverlay from './TrainingOverlay';
import RoundedBarChart from './RoundedBarChart';
import { sessionsWeeklyBars, type TrainingSession } from '@/lib/training/sessions';
import { formatVolume, formatDuration } from '@/lib/workouts/summary';
import { parseDateLocal } from '@/lib/formatters';

/**
 * The larger window behind the Weekly Activity bubble: a 12-week view with
 * the full totals per week. Numbers only describe the athlete's own history —
 * progress framing, never comparison.
 */

interface WeeklyActivityOverlayProps {
  /** Workouts AND activities (src/lib/training/sessions.ts mergeSessions). */
  sessions: TrainingSession[];
  onClose: () => void;
}

const weekLabel = (weekStart: string) =>
  parseDateLocal(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function WeeklyActivityOverlay({ sessions, onClose }: WeeklyActivityOverlayProps) {
  const bars = useMemo(() => sessionsWeeklyBars(sessions, 12), [sessions]);
  const [view, setView] = useState<'sessions' | 'load'>('sessions');
  const trained = bars.filter(b => b.workouts > 0).length;

  return (
    <TrainingOverlay
      title="Weekly activity"
      subtitle={`Trained in ${trained} of the last 12 weeks`}
      onClose={onClose}
    >
      {/* A11: the same weeks as sessions or as load (minutes × effort, rated sessions only). */}
      <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Show">
        {(['sessions', 'load'] as const).map(v => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            onClick={() => setView(v)}
            className={`ea-interactive min-h-[44px] rounded-full border px-4 text-sm font-semibold ${view === v ? 'border-brand bg-brand-soft text-brand-fg' : 'border-border text-primary'}`}
            data-weekly-view={v}
          >
            {v === 'sessions' ? 'Sessions' : 'Load'}
          </button>
        ))}
      </div>
      <div className="rounded-2xl bg-surface-muted p-4 sm:p-5 mb-5">
        <RoundedBarChart
          bars={bars.map((b, i) => ({
            // First + current only — 12 labels truncate on phones, and the
            // per-week rows below carry every date anyway.
            label: i === 0 || b.isCurrent ? weekLabel(b.weekStart) : '',
            value: view === 'load' ? b.load : b.workouts,
            highlight: b.isCurrent,
            meta:
              view === 'load'
                ? `Week of ${weekLabel(b.weekStart)} — load ${b.load.toLocaleString()} (${b.rated} of ${b.workouts} rated)`
                : `Week of ${weekLabel(b.weekStart)} — ${b.workouts} session${b.workouts !== 1 ? 's' : ''}`,
          }))}
          color="var(--brand-fg)"
          height={140}
          ariaLabel={view === 'load' ? 'Training load per week, last 12 weeks' : 'Sessions per week, last 12 weeks'}
          valueLabels="all"
        />
        {view === 'load' && <p className="mt-2 text-xs text-muted">Load is minutes × how hard it was (1–10), for the sessions you rated.</p>}
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
              {bar.workouts} session{bar.workouts !== 1 ? 's' : ''}
              {bar.volumeLbs > 0 && <> · {formatVolume(bar.volumeLbs)}</>}
              {bar.seconds > 0 && <> · {formatDuration(bar.seconds)}</>}
              {bar.rated > 0 && <span data-week-load={bar.load}> · load {bar.load.toLocaleString()}</span>}
            </span>
          </div>
        ))}
      </div>
    </TrainingOverlay>
  );
}
