'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { useToast } from '../Toast';
import RoutineEditorModal from './RoutineEditorModal';
import { MAX_ROUTINES, type WorkoutRoutine } from '@/lib/workouts/routines';

/**
 * The one routine-management surface, shared by main Settings (Routines tab)
 * and the Vitals quick-settings modal. Owns fetching and CRUD; permanent
 * preset edits happen ONLY here — in-session changes never touch a routine
 * (copy-on-start).
 */

export default function RoutineManager() {
  const { showSuccess, showError } = useToast();
  const [routines, setRoutines] = useState<WorkoutRoutine[] | null>(null);
  const [editing, setEditing] = useState<{ routine: WorkoutRoutine | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkoutRoutine | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Inlined cancellable IIFE (not a callback call) so it stays out of the
  // set-state-in-effect warning list; saves refresh by bumping reloadKey.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/workout-routines', { credentials: 'include' });
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        if (!cancelled) setRoutines(data.routines ?? []);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load routines:', e);
        setRoutines([]);
        showError('Error', 'Failed to load routines');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, showError]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/workout-routines/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`${response.status}`);
      setRoutines(prev => (prev ?? []).filter(r => r.id !== deleteTarget.id));
      showSuccess('Routine deleted', `“${deleteTarget.name}” is gone. Past workouts are unaffected.`);
    } catch (e) {
      console.error('Failed to delete routine:', e);
      showError('Error', 'Failed to delete routine');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const atCap = (routines?.length ?? 0) >= MAX_ROUTINES;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted">
          Start a workout from a routine and its exercises are ready with empty sets.
          Changes during a workout never affect the saved routine.
        </p>
      </div>

      {routines === null ? (
        <p className="py-6 text-sm text-muted text-center">Loading routines…</p>
      ) : routines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted text-center">
          No saved routines yet. Save one when you finish a workout, or build one here.
        </p>
      ) : (
        <ul className="space-y-2">
          {routines.map(routine => (
            <li
              key={routine.id}
              className="flex items-center gap-3 bg-surface rounded-xl border border-border px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-bold text-primary">{routine.name}</p>
                <p className="text-xs text-muted">
                  {routine.exercises.length}{' '}
                  {routine.exercises.length === 1 ? 'exercise' : 'exercises'}
                  {' · updated '}
                  {new Date(routine.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <button
                onClick={() => setEditing({ routine })}
                className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold text-secondary bg-surface border border-border-strong hover:bg-surface-muted transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteTarget(routine)}
                className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold text-red-600 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {routines !== null && !atCap && (
        <button
          onClick={() => setEditing({ routine: null })}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-brand-fg-strong bg-brand-soft hover:bg-violet-100 dark:hover:bg-violet-900/60 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New routine
        </button>
      )}
      {atCap && (
        <p className="mt-3 text-xs text-muted text-center">
          Routine limit reached ({MAX_ROUTINES}). Delete one to add another.
        </p>
      )}

      {editing && (
        <RoutineEditorModal
          routine={editing.routine}
          onClose={() => setEditing(null)}
          onSaved={() => setReloadKey(k => k + 1)}
        />
      )}

      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="Delete routine?"
        message={`“${deleteTarget?.name ?? ''}” will be permanently deleted. Workouts you started from it are unaffected.`}
        confirmText={deleting ? 'Deleting…' : 'Delete'}
        cancelText="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        overlayZClass="z-[60]"
      />
    </div>
  );
}
