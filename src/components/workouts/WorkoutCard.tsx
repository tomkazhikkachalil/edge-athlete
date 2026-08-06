'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Dumbbell } from 'lucide-react';
import { computeSummary, formatDuration, formatVolume, formatSetLine } from '@/lib/workouts/summary';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import SetMediaStrip from './SetMediaStrip';

interface WorkoutCardProps {
  session: ServerWorkoutSession;
  /** Opens the linked feed post (shared workouts). */
  onOpenPost?: (postId: string) => void;
}

/** Expandable workout history card for the Edge Vitals tab. */
export default function WorkoutCard({ session, onOpenPost }: WorkoutCardProps) {
  const [expanded, setExpanded] = useState(false);
  const entries = useMemo(() => serverToEntries(session), [session]);
  const summary = useMemo(() => computeSummary(entries), [entries]);

  const dateLabel = new Date(session.started_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full text-left p-4 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center flex-shrink-0">
              <Dumbbell className="w-4 h-4 text-brand-fg" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-primary truncate">
                  {session.title || 'Workout'}
                </h4>
                {session.post_id && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      onOpenPost?.(session.post_id!);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        onOpenPost?.(session.post_id!);
                      }
                    }}
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
                  >
                    Shared
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-0.5">
                {dateLabel}
                {session.duration_seconds ? ` · ${formatDuration(session.duration_seconds)}` : ''}
                {` · ${summary.exerciseCount} exercise${summary.exerciseCount === 1 ? '' : 's'} · ${summary.totalSets} set${summary.totalSets === 1 ? '' : 's'}`}
              </p>
              {summary.totalVolumeLbs > 0 && (
                <p className="text-xs text-brand-fg font-semibold mt-0.5">
                  {formatVolume(summary.totalVolumeLbs)} total volume
                </p>
              )}
            </div>
          </div>
          <span className="text-faint mt-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-subtle bg-surface-muted px-4 py-3 space-y-3">
          {entries.length === 0 && (
            <p className="text-xs text-muted">No exercises logged.</p>
          )}
          {entries.map((exercise, index) => (
            <div key={index}>
              <p className="text-xs font-bold text-secondary">{exercise.name}</p>
              {exercise.notes && (
                <p className="text-xs text-muted italic">{exercise.notes}</p>
              )}
              <div className="mt-1 space-y-1">
                {exercise.sets.map((set, setIndex) => (
                  <div key={setIndex}>
                    <p className="text-xs text-tertiary">
                      <span className="text-faint">Set {set.setNumber}</span> · {formatSetLine(set)}
                    </p>
                    {set.media.length > 0 && <SetMediaStrip media={set.media} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {session.notes && (
            <p className="text-xs text-muted italic border-t border-border-subtle pt-2">
              {session.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
