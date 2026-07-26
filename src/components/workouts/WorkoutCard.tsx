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
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Dumbbell className="w-4 h-4 text-violet-600" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-gray-900 truncate">
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
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors"
                  >
                    Shared
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {dateLabel}
                {session.duration_seconds ? ` · ${formatDuration(session.duration_seconds)}` : ''}
                {` · ${summary.exerciseCount} exercise${summary.exerciseCount === 1 ? '' : 's'} · ${summary.totalSets} set${summary.totalSets === 1 ? '' : 's'}`}
              </p>
              {summary.totalVolumeLbs > 0 && (
                <p className="text-xs text-violet-600 font-semibold mt-0.5">
                  {formatVolume(summary.totalVolumeLbs)} total volume
                </p>
              )}
            </div>
          </div>
          <span className="text-gray-400 mt-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-3">
          {entries.length === 0 && (
            <p className="text-xs text-gray-500">No exercises logged.</p>
          )}
          {entries.map((exercise, index) => (
            <div key={index}>
              <p className="text-xs font-bold text-gray-700">{exercise.name}</p>
              {exercise.notes && (
                <p className="text-xs text-gray-500 italic">{exercise.notes}</p>
              )}
              <div className="mt-1 space-y-1">
                {exercise.sets.map((set, setIndex) => (
                  <div key={setIndex}>
                    <p className="text-xs text-gray-600">
                      <span className="text-gray-400">Set {set.setNumber}</span> · {formatSetLine(set)}
                    </p>
                    {set.media.length > 0 && <SetMediaStrip media={set.media} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {session.notes && (
            <p className="text-xs text-gray-500 italic border-t border-gray-100 pt-2">
              {session.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
