'use client';

import { useMemo, useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, Dumbbell, Globe, Pencil, Trash2 } from 'lucide-react';
import { computeSummary, formatDuration, formatVolume, formatSetLine } from '@/lib/workouts/summary';
import { entriesToRoutineExercises } from '@/lib/workouts/routines';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import SetMediaStrip from './SetMediaStrip';
import ConfirmModal from '../ConfirmModal';
import { useToast } from '../Toast';

interface WorkoutCardProps {
  session: ServerWorkoutSession;
  /** Opens the linked feed post (shared workouts). */
  onOpenPost?: (postId: string) => void;
  /** Owner-only actions render when true. */
  isOwnProfile?: boolean;
  /** Reopen the workout in the review editor. */
  onEdit?: () => void;
  /** Deep-link to the share step (unshared workouts only). */
  onShare?: () => void;
  /** Called after a successful delete; caller removes/refetches. */
  onDeleted?: () => void;
}

/** Expandable workout history card for the Edge Vitals tab. */
export default function WorkoutCard({
  session, onOpenPost, isOwnProfile = false, onEdit, onShare, onDeleted,
}: WorkoutCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [routineName, setRoutineName] = useState('');
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [routineError, setRoutineError] = useState('');
  const { showSuccess, showError } = useToast();
  const entries = useMemo(() => serverToEntries(session), [session]);
  const summary = useMemo(() => computeSummary(entries), [entries]);

  const dateLabel = new Date(session.started_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const response = await fetch(`/api/workouts/${session.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to delete workout');
      }
      showSuccess('Deleted', 'Workout removed from your history');
      onDeleted?.();
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to delete workout');
      setDeleting(false);
    }
  };

  const handleSaveRoutine = async () => {
    if (savingRoutine) return;
    const name = routineName.trim() || session.title?.trim() || 'Workout';
    setSavingRoutine(true);
    setRoutineError('');
    try {
      const response = await fetch('/api/workout-routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, exercises: entriesToRoutineExercises(entries) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRoutineError(data.error || 'Failed to save routine');
        return;
      }
      showSuccess('Routine saved', `Pick “${name}” next time you start a workout.`);
      setSavePromptOpen(false);
    } catch (err) {
      console.error('Failed to save routine:', err);
      setRoutineError('Failed to save routine');
    } finally {
      setSavingRoutine(false);
    }
  };

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

          {/* Owner actions — always visible when expanded (no hover reveal:
              hover: is invisible on touch). Lives OUTSIDE the header button,
              so no nested-interactive. EquipmentCard actions-row style. */}
          {isOwnProfile && (
            <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
              <button
                type="button"
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                Edit
              </button>
              {!session.post_id && (
                <button
                  type="button"
                  onClick={onShare}
                  className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                  Share to Feed
                </button>
              )}
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setRoutineName(session.title || '');
                    setRoutineError('');
                    setSavePromptOpen(prev => !prev);
                  }}
                  aria-label="Save as routine"
                  title="Save as routine"
                  className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg border border-border-strong bg-surface text-secondary hover:bg-surface-muted transition-colors"
                >
                  <Bookmark className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                aria-label="Delete workout"
                title="Delete workout"
                className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Inline save-as-routine prompt — no extra modal layer needed */}
          {isOwnProfile && savePromptOpen && (
            <div className="border-t border-border-subtle pt-3">
              <p className="text-xs font-semibold text-secondary mb-2">
                Save this exercise list as a routine
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={routineName}
                  onChange={e => {
                    setRoutineName(e.target.value.slice(0, 120));
                    setRoutineError('');
                  }}
                  placeholder="Routine name"
                  aria-label="Routine name"
                  className="flex-1 min-w-0 px-3 py-2.5 border border-border-strong rounded-lg text-sm bg-surface focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveRoutine}
                  disabled={savingRoutine}
                  className="shrink-0 px-4 min-h-[44px] rounded-lg text-sm font-bold text-white bg-brand hover:bg-brand-hover transition-colors disabled:opacity-50"
                >
                  {savingRoutine ? 'Saving…' : 'Save'}
                </button>
              </div>
              {routineError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">{routineError}</p>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete Workout"
        message={`This permanently deletes this workout and everything you logged. This cannot be undone.${session.post_id ? ' Your shared post stays on the feed.' : ''}`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
