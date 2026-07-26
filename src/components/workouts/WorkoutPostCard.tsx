'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Dumbbell, Timer, TrendingUp } from 'lucide-react';
import { formatDuration, formatVolume, formatSetLine } from '@/lib/workouts/summary';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import type { EntryExercise } from '@/lib/workouts/entries';
import SetMediaStrip from './SetMediaStrip';

interface WorkoutPostCardProps {
  /** posts.stats_data for type='workout_session' (denormalized summary). */
  statsData: Record<string, unknown>;
}

type DetailState =
  | { status: 'collapsed' }
  | { status: 'loading' }
  | { status: 'loaded'; exercises: EntryExercise[] }
  | { status: 'unavailable' };

/**
 * Compact workout summary card on feed posts — collapsed renders entirely
 * from the denormalized stats_data (zero fetches while scrolling); Details
 * lazy-fetches the full session breakdown once. Built to stay scannable
 * when a profile holds hundreds of workouts.
 */
export default function WorkoutPostCard({ statsData }: WorkoutPostCardProps) {
  const [detail, setDetail] = useState<DetailState>({ status: 'collapsed' });

  const title = (statsData.title as string) || 'Workout';
  const durationSeconds = (statsData.duration_seconds as number) || 0;
  const exerciseCount = (statsData.exercise_count as number) || 0;
  const totalSets = (statsData.total_sets as number) || 0;
  const totalVolumeLbs = (statsData.total_volume_lbs as number) || 0;
  const topLine = (statsData.top_line as string) || null;
  const sessionId = statsData.workout_session_id as string | undefined;

  const expanded = detail.status !== 'collapsed';

  const toggle = async () => {
    if (expanded) {
      setDetail({ status: 'collapsed' });
      return;
    }
    if (!sessionId) {
      setDetail({ status: 'unavailable' });
      return;
    }
    setDetail({ status: 'loading' });
    try {
      const response = await fetch(`/api/workouts/${sessionId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      setDetail({
        status: 'loaded',
        exercises: serverToEntries(data.session as ServerWorkoutSession),
      });
    } catch {
      // Session deleted or not visible to this viewer — summary still stands
      setDetail({ status: 'unavailable' });
    }
  };

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/60 overflow-hidden mb-2">
      {/* Collapsed summary — all from denormalized stats_data */}
      <div className="px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
            <Dumbbell className="w-4 h-4 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate">{title}</p>
            {topLine && <p className="text-xs text-violet-700 truncate">Top set: {topLine}</p>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white rounded-lg px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-sm font-bold text-gray-900">
              <Timer className="w-3 h-3 text-violet-500" aria-hidden="true" />
              {formatDuration(durationSeconds)}
            </div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Duration</div>
          </div>
          <div className="bg-white rounded-lg px-2 py-1.5 text-center">
            <div className="text-sm font-bold text-gray-900">
              {exerciseCount} · {totalSets}
            </div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Exercises · Sets</div>
          </div>
          <div className="bg-white rounded-lg px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-sm font-bold text-gray-900">
              <TrendingUp className="w-3 h-3 text-violet-500" aria-hidden="true" />
              {totalVolumeLbs > 0 ? formatVolume(totalVolumeLbs) : '—'}
            </div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Volume</div>
          </div>
        </div>
      </div>

      {/* Expanded details — lazy-fetched once */}
      {detail.status === 'loading' && (
        <div className="flex justify-center py-4 border-t border-violet-100">
          <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-violet-500" aria-hidden="true" />
        </div>
      )}
      {detail.status === 'unavailable' && (
        <p className="px-3.5 py-3 border-t border-violet-100 text-xs text-gray-500">
          Full details unavailable.
        </p>
      )}
      {detail.status === 'loaded' && (
        <div className="px-3.5 py-3 border-t border-violet-100 bg-white/60 space-y-3">
          {detail.exercises.length === 0 && (
            <p className="text-xs text-gray-500">No exercises logged.</p>
          )}
          {detail.exercises.map((exercise, index) => (
            <div key={index}>
              <p className="text-xs font-bold text-gray-800">{exercise.name}</p>
              <div className="mt-0.5 space-y-1">
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
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-center gap-1 py-1.5 border-t border-violet-100 text-xs font-semibold text-violet-700 hover:bg-violet-100/60 transition-colors"
      >
        {expanded ? (
          <>
            Hide details <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          </>
        ) : (
          <>
            Details <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  );
}
