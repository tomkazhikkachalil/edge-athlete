'use client';

// Training's Exercises view (Training redesign PR 5, Nov 11 2026): one row per
// exercise the athlete has trained, grouped by body area, most recently
// trained first — the row shows the exercise's ONE headline best and opens
// its page. It replaces the owner-only records table (five columns at
// 375 px), the Progress chip picker and its single "Workouts" group. A
// visitor sees it too: the server folds what that viewer may see.

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Dumbbell } from 'lucide-react';
import SectionInfo from '@/components/SectionInfo';
import SectionEmptyState from '@/components/SectionEmptyState';
import { groupByArea, type ExerciseSummary } from '@/lib/workouts/exercise-list';
import { formatPr, PR_SHORT_LABELS } from '@/lib/workouts/prs';
import ExerciseDetailOverlay from './ExerciseDetailOverlay';

type Wire = Omit<ExerciseSummary, 'lastAt' | 'sessions'> & { lastAt: string | null; sessions: number | null };
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'hidden' } | { kind: 'ready'; exercises: Wire[]; unit: 'lb' | 'kg' };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

interface TrainingExercisesProps {
  profileId: string;
  isOwnProfile: boolean;
  /** The exercise whose page is open (the URL's `exercise`), or null. */
  openRef: string | null;
  onOpen: (ref: string | null) => void;
}

export default function TrainingExercises({ profileId, isOwnProfile, openRef, onOpen }: TrainingExercisesProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetch(`/api/profile/${profileId}/training/bests`, { credentials: 'include', cache: 'no-store' })
      .then(async res => {
        if (!live) return;
        // A 404 is the gate's refusal (blocked, departed): nothing to show, never an error.
        if (res.status === 404) return setState({ kind: 'hidden' });
        if (!res.ok) return setState({ kind: 'error' });
        const body = (await res.json()) as { exercises?: Wire[]; unit?: 'lb' | 'kg'; hidden?: boolean };
        if (!live) return;
        setState(body.hidden ? { kind: 'hidden' } : { kind: 'ready', exercises: body.exercises ?? [], unit: body.unit === 'kg' ? 'kg' : 'lb' });
      })
      .catch(() => live && setState({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, [profileId]);

  const groups = useMemo(() => (state.kind === 'ready' ? groupByArea(state.exercises as ExerciseSummary[]) : []), [state]);
  const ready = state.kind === 'ready' ? state : null;

  return (
    <section className="space-y-4" data-training-exercises={ready ? ready.exercises.length : state.kind}>
      <SectionInfo as="h3" heading="Exercises" headingClassName="text-base font-bold text-primary" dense>
        <p>Every exercise you have logged, with its best. Tap one for its bests, its chart and every session it was in.</p>
      </SectionInfo>

      {state.kind === 'loading' && (
        <div className="flex justify-center py-12" aria-busy="true">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      )}
      {state.kind === 'error' && <p className="py-8 text-center text-secondary">Could not load the exercises. Check your connection and try again.</p>}
      {state.kind === 'hidden' && <p className="py-8 text-center text-sm text-muted" data-training-exercises-empty="hidden">Nothing to show here.</p>}

      {ready && ready.exercises.length === 0 && (
        <div data-training-exercises-empty="none">
          <SectionEmptyState
            icon={Dumbbell}
            title="No exercises yet"
            body={isOwnProfile ? 'Log a workout and every exercise in it gets a page here: its bests, its chart and its history.' : 'This athlete has not logged an exercise yet.'}
          />
        </div>
      )}

      {ready &&
        groups.map(group => (
          <div key={group.area} data-exercise-area={group.area}>
            <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">{group.label}</h4>
            <ul className="space-y-2">
              {group.items.map(e => (
                <li key={e.ref}>
                  <button type="button" onClick={() => onOpen(e.ref)} className="ea-surface ea-interactive flex w-full items-center gap-3 rounded-lg p-3 text-left" data-exercise-row={e.ref}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-primary">{e.name}</span>
                      {e.lastAt && (
                        <span className="block truncate text-xs text-muted">
                          Last trained {day(e.lastAt)}
                          {typeof e.sessions === 'number' ? ` · ${e.sessions} session${e.sessions !== 1 ? 's' : ''}` : ''}
                        </span>
                      )}
                    </span>
                    {e.headline && (
                      <span className="shrink-0 text-right">
                        <span className="block text-base font-bold text-primary tabular-nums" data-exercise-headline={e.headline.kind}>{formatPr(e.headline.kind, e.headline.value, ready.unit)}</span>
                        <span className="block text-xs text-muted">{PR_SHORT_LABELS[e.headline.kind]}</span>
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {openRef && <ExerciseDetailOverlay profileId={profileId} exerciseRef={openRef} fallbackName={ready?.exercises.find(e => e.ref === openRef)?.name} onClose={() => onOpen(null)} />}
    </section>
  );
}
