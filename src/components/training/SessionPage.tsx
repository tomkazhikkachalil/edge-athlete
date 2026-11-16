'use client';

// One workout's own page inside Training ("one wave", phase 2, PR 2 — Nov 2026):
// the level under a week. Read-only for everyone the session's gate admits
// (GET /api/workouts/[id]) — a visitor could not open a single workout before
// this; the owner's Edit stays the door to the editor. Its address is
// `&session=<id>`; the trail is its week's way up, known once it has loaded.
// An activity's page is its own route (/activities/[id]).

import { useEffect, useState } from 'react';
import WorkoutCard from '@/components/workouts/WorkoutCard';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';
import { scopeTrail, type HistoryScope } from '@/lib/training/timeline';
import { scopeLabel } from './TrainingTimeline';

type State = { kind: 'loading' } | { kind: 'gone' } | { kind: 'error' } | { kind: 'ready'; session: ServerWorkoutSession };

interface SessionPageProps {
  sessionId: string;
  isOwnProfile: boolean;
  onScope: (scope: HistoryScope) => void;
  onOpenPost: (postId: string) => void;
  onEdit: (sessionId: string) => void;
  onShare: (sessionId: string) => void;
  /** The workout was deleted: the Overview's numbers are stale. */
  onChanged: () => void;
}

export default function SessionPage({ sessionId, isOwnProfile, onScope, onOpenPost, onEdit, onShare, onChanged }: SessionPageProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workouts/${sessionId}`, { credentials: 'include', cache: 'no-store' })
      .then(async res => {
        if (cancelled) return;
        // 403 / 404 are the gate's answers (private, hidden, a draft, no such workout): one plain line, never an error.
        if (res.status === 403 || res.status === 404 || res.status === 400) return setState({ kind: 'gone' });
        if (!res.ok) return setState({ kind: 'error' });
        const body = (await res.json()) as { session?: ServerWorkoutSession };
        if (cancelled) return;
        setState(body.session ? { kind: 'ready', session: body.session } : { kind: 'gone' });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const session = state.kind === 'ready' ? state.session : null;
  const trail = scopeTrail({ level: 'session', id: sessionId }, session?.started_at);
  const up = trail[trail.length - 1] ?? { level: 'all' as const };

  return (
    <section className="space-y-4 scroll-mt-24" aria-label={session?.title || 'Workout'} data-timeline-level="session">
      <nav aria-label="Training history" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
        {trail.map(step => (
          <span key={JSON.stringify(step)} className="inline-flex items-center gap-1">
            <button type="button" onClick={() => onScope(step)} className="ea-interactive inline-flex min-h-[44px] items-center rounded-lg px-2 font-semibold text-brand-fg" data-timeline-up={step.level}>
              {scopeLabel(step, true)}
            </button>
            <span className="text-muted" aria-hidden="true">›</span>
          </span>
        ))}
        <span className="min-w-0 truncate px-2 font-semibold text-primary" aria-current="page">{session?.title || 'Workout'}</span>
      </nav>

      {state.kind === 'loading' && (
        <div className="flex justify-center py-12" aria-busy="true">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      )}
      {state.kind === 'error' && <p className="py-8 text-center text-secondary">Could not load this workout. Check your connection and try again.</p>}
      {state.kind === 'gone' && (
        <div className="ea-surface rounded-lg p-8 text-center" data-timeline-empty="session">
          <p className="font-semibold text-primary">This workout is not available</p>
          <button type="button" onClick={() => onScope({ level: 'all' })} className="ea-interactive mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm font-semibold text-primary">
            Back to History
          </button>
        </div>
      )}
      {session && (
        <div data-timeline-session-page={session.id}>
          <WorkoutCard
            session={session}
            defaultExpanded
            isOwnProfile={isOwnProfile}
            onOpenPost={onOpenPost}
            onEdit={() => onEdit(session.id)}
            onShare={() => onShare(session.id)}
            onDeleted={() => {
              onChanged();
              onScope(up);
            }}
          />
        </div>
      )}
    </section>
  );
}
