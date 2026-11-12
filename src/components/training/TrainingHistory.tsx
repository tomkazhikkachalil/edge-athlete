'use client';

// Training's History view (Training redesign PR 4, Nov 11 2026): every
// completed workout and every activity in ONE list, newest first, grouped by
// month, paged by "Load more". It replaces the workouts window (the last 50
// sessions), the separate Activities section and the training-posts grid —
// a session now has one row in one place. A workout row is the card it always
// was (expand for the sets; the owner's actions; "Shared" opens the post); an
// activity row opens the activity's page. The server decides what a viewer
// receives (history-server.ts); a viewer with nothing to see is told so.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SectionInfo from '@/components/SectionInfo';
import WorkoutCard from '@/components/workouts/WorkoutCard';
import FaIcon from '@/components/FaIcon';
import { faLink } from '@/lib/icons/fa/link';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';
import { readUnitPreference, type DistanceUnit } from '@/lib/activities/format';
import type { WeekTotal } from '@/lib/activities/totals';
import { groupByMonth, HISTORY_KINDS, type HistoryKind } from '@/lib/training/history';
import type { HistoryEntry } from '@/lib/training/history-server';
import ActivityHistoryRow from './ActivityHistoryRow';
import ActivityWeekTotals from './ActivityWeekTotals';

interface Page {
  items: HistoryEntry[];
  next: string | null;
  isOwner: boolean;
  hidden?: boolean;
  totals?: WeekTotal[];
  count?: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'hidden' }
  | { kind: 'ready'; items: HistoryEntry[]; next: string | null; isOwner: boolean; totals: WeekTotal[] };

interface TrainingHistoryProps {
  profileId: string;
  isOwnProfile: boolean;
  /** `?tab=activities` (the old deep link) opens History already filtered to activities. */
  initialKind?: HistoryKind;
  onOpenPost: (postId: string) => void;
  onEditWorkout: (sessionId: string) => void;
  onShareWorkout: (sessionId: string) => void;
  /** A workout was deleted: the Overview's numbers are stale. */
  onChanged: () => void;
}

export default function TrainingHistory({ profileId, isOwnProfile, initialKind = 'all', onOpenPost, onEditWorkout, onShareWorkout, onChanged }: TrainingHistoryProps) {
  const [kind, setKind] = useState<HistoryKind>(initialKind);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const { user } = useAuth();
  const isSelf = user?.id === profileId;
  const [unit] = useState<DistanceUnit>(() => (typeof window === 'undefined' ? 'km' : readUnitPreference()));
  // A slow first page of one filter must never land on top of another's.
  const requestRef = useRef(0);

  const fetchPage = useCallback(
    async (which: HistoryKind, cursor: string | null): Promise<Page | 'hidden' | null> => {
      try {
        const query = new URLSearchParams({ kind: which, ...(cursor ? { cursor } : {}) });
        const res = await fetch(`/api/profile/${profileId}/training/history?${query.toString()}`, { credentials: 'include', cache: 'no-store' });
        // A 404 is the gate's refusal (blocked, departed): nothing to show, never an error.
        if (res.status === 404) return 'hidden';
        if (!res.ok) return null;
        return (await res.json()) as Page;
      } catch {
        return null;
      }
    },
    [profileId]
  );

  useEffect(() => {
    const request = ++requestRef.current;
    void fetchPage(kind, null).then(page => {
      if (request !== requestRef.current) return;
      if (page === 'hidden' || (page && page.hidden)) setState({ kind: 'hidden' });
      else if (!page) setState({ kind: 'error' });
      else setState({ kind: 'ready', items: page.items, next: page.next, isOwner: page.isOwner, totals: page.totals ?? [] });
    });
  }, [fetchPage, kind]);

  const changeKind = (next: HistoryKind) => {
    if (next === kind) return;
    setState({ kind: 'loading' });
    setMoreFailed(false);
    setKind(next);
  };

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.next || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    setMoreFailed(false);
    const page = await fetchPage(kind, state.next);
    setLoadingMore(false);
    if (request !== requestRef.current) return;
    if (!page || page === 'hidden') return setMoreFailed(true);
    setState(s => (s.kind === 'ready' ? { ...s, items: [...s.items, ...page.items], next: page.next } : s));
  };

  const months = useMemo(() => (state.kind === 'ready' ? groupByMonth(state.items) : []), [state]);
  const ready = state.kind === 'ready' ? state : null;

  return (
    <section className="space-y-4 scroll-mt-24" id="training-history" data-training-history={kind} data-activities-tab={kind === 'activities' ? '' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionInfo as="h3" heading="History" headingClassName="text-base font-bold text-primary" dense>
          <p>Every workout and every activity, newest first. Tap a workout for its sets; an activity opens its own page.</p>
        </SectionInfo>
        {/* Connections are the account's own (Settings): offered to the athlete, never to a guardian looking at their athlete's Training. */}
        {FEATURE_FLAGS.FEATURE_CONNECTED_APPS && isSelf && kind === 'activities' && (
          <Link href="/settings?tab=connections" className="tr-pill inline-flex shrink-0 items-center gap-1.5 min-h-[44px] px-5 border border-border-strong text-secondary rounded-full text-sm font-semibold hover:bg-surface-muted transition-colors" data-activities-connect-link>
            <FaIcon icon={faLink} className="text-xs" />
            Connect a watch
          </Link>
        )}
      </div>

      <div role="group" aria-label="Show" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {HISTORY_KINDS.map(k => (
          <button
            key={k.id}
            type="button"
            aria-pressed={k.id === kind}
            onClick={() => changeKind(k.id)}
            className={`tr-pill shrink-0 min-h-[40px] rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
              k.id === kind ? 'bg-surface-inverse text-inverse' : 'border border-border text-secondary hover:bg-surface-muted hover:text-primary'
            }`}
            data-history-kind={k.id}
          >
            {k.label}
          </button>
        ))}
      </div>

      {state.kind === 'loading' && (
        <div className="flex justify-center py-12" aria-busy="true">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      )}
      {state.kind === 'error' && <p className="py-8 text-center text-secondary">Could not load the history. Check your connection and try again.</p>}
      {state.kind === 'hidden' && <p className="py-8 text-center text-sm text-muted" data-training-history-empty="hidden">Nothing to show here.</p>}

      {ready && ready.items.length === 0 && (
        <div className="ea-surface rounded-lg p-8 text-center" data-training-history-empty={kind}>
          <p className="font-semibold text-primary">
            {isOwnProfile
              ? kind === 'activities' ? 'Your walks, runs, rides and more' : kind === 'workouts' ? 'No workouts yet' : 'Nothing recorded yet'
              : kind === 'activities' ? 'No activities yet' : kind === 'workouts' ? 'No workouts yet' : 'No sessions yet'}
          </p>
          {isOwnProfile && <p className="text-sm text-secondary mt-1">Start records one live — a workout with sets, reps and weight, or an activity with a timer or a map.</p>}
        </div>
      )}

      {ready && ready.items.length > 0 && (
        <>
          {kind === 'activities' && <ActivityWeekTotals totals={ready.totals} unit={unit} />}
          <div className="space-y-5">
            {months.map(month => (
              <div key={month.key} data-history-month={month.key}>
                <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">{month.label}</h4>
                <ul className="space-y-2">
                  {month.items.map(entry => (
                    <li key={`${entry.kind}:${entry.id}`} data-history-item={entry.kind}>
                      {entry.kind === 'workout' ? (
                        <WorkoutCard
                          session={entry.session}
                          onOpenPost={onOpenPost}
                          isOwnProfile={isOwnProfile}
                          onEdit={() => onEditWorkout(entry.id)}
                          onShare={() => onShareWorkout(entry.id)}
                          onDeleted={() => {
                            setState(s => (s.kind === 'ready' ? { ...s, items: s.items.filter(i => !(i.kind === 'workout' && i.id === entry.id)) } : s));
                            onChanged();
                          }}
                        />
                      ) : (
                        <ActivityHistoryRow activity={entry.activity} unit={unit} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {ready.next && (
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="ea-interactive rounded-lg border border-border px-4 py-2 font-semibold text-primary min-h-[44px] disabled:opacity-60" data-training-history-more="">
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
              {moreFailed && <p className="text-sm text-secondary" role="status">Could not load more. Check your connection and try again.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
