'use client';

// The profile's activities — a SECTION OF VITALS since Oct 1 2026 (it was its
// own profile tab; `?tab=activities` still lands here, see VitalsTab).
// It fetches its OWN gated endpoint (the /u/ payload is CDN-cached as a
// stranger's view; the Vitals tab's pattern) and renders what came back:
// this week, twelve weeks of distance, the list (newest first, "Load more"
// pages by cursor). The owner gets Import; a viewer's list never holds an
// "Only me" activity (the server's rule) and every route thumbnail is the
// stored, already-trimmed preview.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import { formatDistance, formatDuration, formatPace, readUnitPreference, type DistanceUnit } from '@/lib/activities/format';
import type { WeekTotal } from '@/lib/activities/totals';
import type { ActivityView } from '@/lib/activities/visibility';
import RouteThumb from './RouteThumb';

interface Page {
  items: ActivityView[];
  next: string | null;
  totals: WeekTotal[] | null;
  count: number | null;
  isOwner: boolean;
  /** The athlete hides Vitals (or its Workouts aspect) from this viewer. */
  hidden?: boolean;
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'hidden' } | { kind: 'ready'; items: ActivityView[]; next: string | null; totals: WeekTotal[]; count: number; isOwner: boolean };

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
};

export default function ActivitiesTab({ profileId }: { profileId: string }) {
  // Inside Vitals the section explains itself to its owner and stays out of
  // a viewer's way: nothing to show renders nothing (no "not available" line
  // under somebody else's Vitals).
  const [state, setState] = useState<State>({ kind: 'loading' });
  const { user } = useAuth();
  const isSelf = user?.id === profileId;
  const [unit] = useState<DistanceUnit>(() => (typeof window === 'undefined' ? 'km' : readUnitPreference()));
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<Page | 'hidden' | null> => {
      try {
        const res = await fetch(`/api/profile/${profileId}/activities${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
          credentials: 'include',
          cache: 'no-store',
        });
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
    let live = true;
    void fetchPage(null).then(p => {
      if (!live) return;
      if (p === 'hidden' || (p && p.hidden)) setState({ kind: 'hidden' });
      else if (!p) setState({ kind: 'error' });
      else setState({ kind: 'ready', items: p.items, next: p.next, totals: p.totals ?? [], count: p.count ?? p.items.length, isOwner: p.isOwner });
    });
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.next) return;
    setLoadingMore(true);
    const p = await fetchPage(state.next);
    setLoadingMore(false);
    if (p && p !== 'hidden') setState({ ...state, items: [...state.items, ...p.items], next: p.next });
  };

  if (state.kind === 'loading') {
    return (
      <div className="flex justify-center py-12" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }
  if (state.kind === 'hidden') return null;
  if (state.kind === 'error') return <p className="py-8 text-center text-secondary">Could not load activities. Check your connection and try again.</p>;
  if (!state.isOwner && state.count === 0) return null;

  const thisWeek = state.totals.length > 0 ? state.totals[state.totals.length - 1] : null;
  const maxDist = state.totals.reduce((m, w) => (w.distanceM > m ? w.distanceM : m), 0);
  const span = state.totals.reduce((t, w) => ({ distanceM: t.distanceM + w.distanceM, count: t.count + w.count }), { distanceM: 0, count: 0 });

  return (
    <div className="space-y-4 scroll-mt-24" id="vitals-activities" data-activities-tab>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-primary">Activities</h3>
          <p className="text-xs text-muted mt-0.5">Runs, rides, swims and hikes from your watch or app.</p>
        </div>
        {state.isOwner && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Connections are the account's own (Settings): offered to the
                athlete, never to a guardian looking at their athlete's Vitals. */}
            {FEATURE_FLAGS.FEATURE_CONNECTED_APPS && isSelf && (
              <Link href="/settings?tab=connections" className="vt-pill inline-flex shrink-0 items-center gap-1.5 px-4 py-2 border border-border-strong text-secondary rounded-full text-sm font-semibold hover:bg-surface-muted transition-colors min-h-[40px]" data-activities-connect-link>
                <i className="fas fa-link text-xs" aria-hidden="true" />
                Connect a watch
              </Link>
            )}
            <Link href="/activities/record" className="vt-pill inline-flex shrink-0 items-center gap-1.5 px-4 py-2 border border-brand text-brand-fg rounded-full text-sm font-semibold hover:bg-brand-soft transition-colors min-h-[40px]" data-activities-record-link>
              <i className="fas fa-location-dot text-xs" aria-hidden="true" />
              Record activity
            </Link>
            <Link href="/activities/import" className="vt-pill inline-flex shrink-0 items-center gap-1.5 px-4 py-2 border border-border-strong text-secondary rounded-full text-sm font-semibold hover:bg-surface-muted transition-colors min-h-[40px]" data-activities-import-link>
              <i className="fas fa-file-arrow-up text-xs" aria-hidden="true" />
              Import activity
            </Link>
          </div>
        )}
      </div>

      {state.count === 0 ? (
        <div className="ea-surface rounded-lg p-8 text-center">
          <i className="fas fa-person-running text-3xl text-brand-fg mb-3" aria-hidden="true" />
          <p className="font-semibold text-primary">{state.isOwner ? 'Your walks, runs, rides and more' : 'No activities yet'}</p>
          {state.isOwner && <p className="text-sm text-secondary mt-1">Record one live from your phone, or import a .fit, .gpx or .tcx file from your watch or app.</p>}
        </div>
      ) : (
        <>
          {thisWeek && (
            <section className="ea-surface rounded-lg p-4" data-activities-totals>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-primary">This week</h3>
                <p className="text-sm text-secondary tabular-nums">
                  {formatDistance(thisWeek.distanceM, unit)} · {formatDuration(thisWeek.seconds)} · {thisWeek.count} {thisWeek.count === 1 ? 'activity' : 'activities'}
                </p>
              </div>
              <div className="mt-4 flex items-end gap-1 h-20" role="img" aria-label="Distance per week, last 12 weeks">
                {state.totals.map(w => (
                  <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full" title={`${shortDate(w.weekStart)}: ${formatDistance(w.distanceM, unit)}`}>
                    <div
                      className={`rounded-t ${w === thisWeek ? 'bg-brand' : w.distanceM > 0 ? 'bg-brand/45' : 'bg-border'}`}
                      style={{ height: `${maxDist > 0 ? Math.max(w.distanceM > 0 ? 6 : 2, (w.distanceM / maxDist) * 100) : 2}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
                <span>{shortDate(state.totals[0].weekStart)}</span>
                <span>This week</span>
              </div>
              <p className="mt-3 text-sm text-secondary tabular-nums">
                Last 12 weeks: <span className="font-semibold text-primary">{formatDistance(span.distanceM, unit)}</span> · {span.count} {span.count === 1 ? 'activity' : 'activities'}
              </p>
            </section>
          )}

          <ul className="space-y-3">
            {state.items.map(a => {
              const def = ACTIVITY_TYPE_DEFS[a.type];
              const pace = formatPace(a.distanceM, a.movingS ?? a.elapsedS, a.type, unit);
              return (
                <li key={a.id}>
                  <Link href={`/activities/${a.id}`} className="ea-surface ea-interactive flex items-center gap-3 rounded-lg p-3" data-activity-item={a.id}>
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-brand-fg">
                      {a.routePreview ? <RouteThumb preview={a.routePreview} className="h-full w-full" w={96} h={64} /> : <i className={`fas fa-${def.icon} text-xl`} aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-primary">
                        {a.name}
                        {a.owner?.onlyMe && <i className="fas fa-lock ml-2 text-xs text-muted" aria-label="Only me" />}
                      </p>
                      <p className="text-xs text-muted">
                        {def.label} · {shortDate(a.occurredOn)}
                        {a.credit && <span data-activity-credit> · {a.credit}</span>}
                      </p>
                      <p className="mt-1 text-sm text-secondary tabular-nums">
                        {formatDistance(a.distanceM, unit)} · {formatDuration(a.movingS ?? a.elapsedS)} · {pace.value}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {state.next && (
            <div className="flex justify-center">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="ea-interactive rounded-lg border border-border px-4 py-2 font-semibold text-primary min-h-[44px] disabled:opacity-50">
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
