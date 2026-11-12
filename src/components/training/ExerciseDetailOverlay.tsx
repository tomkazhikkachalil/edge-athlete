'use client';

// One exercise's own page (Training redesign PR 5, Nov 11 2026): its bests,
// its chart, its sessions — the three things that were a table column, a chip
// in a picker and a trophy. A larger window, as a metric's is, so the same
// page opens from the list on /athlete, /athlete/[id] and /u/[username].
// Everything shown is what the SERVER folded for this viewer.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import TrainingOverlay from './TrainingOverlay';
import BodyMetricTrendChart from '@/components/charts/BodyMetricTrendChart';
import { BODY_AREAS, type BodyArea } from '@/lib/workout-config';
import { chartKindOf, type ExerciseTimelinePoint } from '@/lib/workouts/exercise-list';
import { formatPr, PR_KIND_RANK, PR_LABELS, type ExerciseBests, type PrKind } from '@/lib/workouts/prs';

interface Detail {
  exercise: { ref: string; name: string; area: BodyArea; bests: ExerciseBests };
  timeline: ExerciseTimelinePoint[];
  sessionsHidden?: boolean;
  unit: 'lb' | 'kg';
  isOwner: boolean;
}

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; detail: Detail };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const chartDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

export default function ExerciseDetailOverlay({ profileId, exerciseRef, fallbackName, onClose }: { profileId: string; exerciseRef: string; fallbackName?: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetch(`/api/profile/${profileId}/training/bests?exercise=${encodeURIComponent(exerciseRef)}`, { credentials: 'include', cache: 'no-store' })
      .then(async res => {
        if (!live) return;
        if (res.status === 404) return setState({ kind: 'missing' });
        if (!res.ok) return setState({ kind: 'error' });
        const detail = (await res.json()) as Detail & { hidden?: boolean };
        if (!live) return;
        setState(detail.hidden || !detail.exercise ? { kind: 'missing' } : { kind: 'ready', detail });
      })
      .catch(() => live && setState({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, [profileId, exerciseRef]);

  const detail = state.kind === 'ready' ? state.detail : null;
  const title = detail?.exercise.name ?? fallbackName ?? 'Exercise';
  const subtitle = detail ? BODY_AREAS.find(a => a.id === detail.exercise.area)?.label : undefined;
  const kinds = detail ? PR_KIND_RANK.filter(k => (detail.exercise.bests[k] ?? null) !== null) : [];
  const chartKind = detail ? chartKindOf(detail.timeline) : null;
  const ascending = detail ? [...detail.timeline].reverse() : [];
  const chartPoints = chartKind ? ascending.filter(p => (p.bests[chartKind] ?? null) !== null) : [];

  return (
    <TrainingOverlay title={title} subtitle={subtitle} onClose={onClose} windowKey="exercise-detail">
      {state.kind === 'loading' && (
        <div className="flex justify-center py-12" aria-busy="true">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      )}
      {state.kind === 'error' && <p className="py-8 text-center text-secondary">Could not load this exercise. Check your connection and try again.</p>}
      {state.kind === 'missing' && <p className="py-8 text-center text-secondary" data-exercise-missing="">There is nothing to show for this exercise.</p>}

      {detail && (
        <div className="space-y-6" data-exercise-detail={detail.exercise.ref}>
          <section>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Bests</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {kinds.map(kind => (
                <div key={kind} className="ea-surface rounded-lg p-3" data-exercise-best={kind}>
                  <dt className="text-xs text-muted">{PR_LABELS[kind]}</dt>
                  <dd className="mt-0.5 text-lg font-bold text-primary tabular-nums">{formatPr(kind as PrKind, detail.exercise.bests[kind]!, detail.unit)}</dd>
                </div>
              ))}
            </dl>
          </section>

          {chartKind && chartPoints.length > 1 && (
            <section>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">{PR_LABELS[chartKind]} by session</p>
              <BodyMetricTrendChart
                title={`${detail.exercise.name} — ${PR_LABELS[chartKind]}`}
                points={chartPoints.map(p => ({ label: chartDay(p.startedAt), value: p.bests[chartKind]! }))}
                color="var(--brand-fg)"
                rollingWindow={0}
                pointNoun="session"
                formatValue={v => formatPr(chartKind, v, detail.unit)}
                milestones={chartPoints.map((p, i) => (p.records.includes(chartKind) ? i : -1)).filter(i => i >= 0)}
              />
            </section>
          )}

          <section>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Sessions</p>
            {detail.sessionsHidden ? (
              <p className="text-sm text-muted" data-exercise-sessions-hidden="">This athlete keeps their sessions private.</p>
            ) : (
              <ul className="space-y-2">
                {detail.timeline.map(p => {
                  const body = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold text-primary">{p.title}</p>
                        <p className="shrink-0 text-xs text-muted">{day(p.startedAt)}</p>
                      </div>
                      <p className="mt-1 text-sm text-secondary tabular-nums">{p.sets.join(' · ')}</p>
                      {p.records.length > 0 && (
                        <p className="mt-2 flex flex-wrap gap-1.5">
                          {p.records.map(kind => (
                            <span key={kind} className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300" data-exercise-session-record={kind}>
                              <Award className="w-3 h-3" aria-hidden="true" />
                              {PR_LABELS[kind]}
                            </span>
                          ))}
                        </p>
                      )}
                    </>
                  );
                  return (
                    <li key={p.sessionId} data-exercise-session={p.sessionId}>
                      {detail.isOwner ? (
                        <Link href={`/app/workout/${p.sessionId}`} className="ea-surface ea-interactive block rounded-lg p-3">
                          {body}
                        </Link>
                      ) : (
                        <div className="ea-surface rounded-lg p-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </TrainingOverlay>
  );
}
