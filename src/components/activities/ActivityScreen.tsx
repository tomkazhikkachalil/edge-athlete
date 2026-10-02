'use client';

// /activities/[id] — an activity as a place. Everything shown is what the
// server's projection sent THIS viewer (visibility.ts): the owner's whole
// route and controls, a viewer's trimmed route, or — for a supervised
// athlete's viewers — no map at all, only the numbers and charts. The page
// never re-derives privacy. Never a dead end: the athlete's profile link
// and the header are always there; a refusal is the house not-found.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { ACTIVITY_TYPE_DEFS, ACTIVITY_TYPES, type ActivityType } from '@/lib/activities/catalog';
import { chartSeries } from '@/lib/activities/charts';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
  formatStart,
  readUnitPreference,
  writeUnitPreference,
  type DistanceUnit,
} from '@/lib/activities/format';
import { splits } from '@/lib/activities/stream';
import type { ActivityDetailView } from '@/lib/activities/visibility';
import ActivityStreamChart from './ActivityStreamChart';
import RouteMap from './RouteMap';

interface Athlete {
  id: string;
  name: string;
  handle: string | null;
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error' } | { state: 'ready'; activity: ActivityDetailView; athlete: Athlete | null };

export default function ActivityScreen({ activityId }: { activityId: string }) {
  const { user } = useAuth();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  // The viewer's unit lives on their device. Read in the initializer: the
  // first paint (server and client alike) is the spinner, which shows no unit.
  const [unit, setUnit] = useState<DistanceUnit>(() => (typeof window === 'undefined' ? 'km' : readUnitPreference()));
  const [hover, setHover] = useState<number | null>(null);

  const fetchActivity = useCallback(async (): Promise<Load> => {
    try {
      const res = await fetch(`/api/activities/${activityId}`, { credentials: 'include', cache: 'no-store' });
      if (res.status === 404) return { state: 'missing' };
      if (!res.ok) return { state: 'error' };
      const body = (await res.json()) as { activity: ActivityDetailView; athlete: Athlete | null };
      return { state: 'ready', activity: body.activity, athlete: body.athlete };
    } catch {
      return { state: 'error' };
    }
  }, [activityId]);

  useEffect(() => {
    let live = true;
    void fetchActivity().then(next => {
      if (live) setLoad(next);
    });
    return () => {
      live = false;
    };
  }, [fetchActivity]);

  const chooseUnit = (u: DistanceUnit) => {
    setUnit(u);
    writeUnitPreference(u);
  };

  if (load.state === 'loading') {
    return (
      <div className="flex justify-center py-16" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }
  if (load.state === 'missing' || load.state === 'error') {
    return (
      <div className="ea-surface rounded-lg p-6 text-center" data-activity-missing>
        <h1 className="text-xl font-bold text-primary mb-2">{load.state === 'missing' ? 'Activity not available' : 'Could not load this activity'}</h1>
        <p className="text-secondary mb-4">
          {load.state === 'missing' ? 'It may have been deleted, or it is private.' : 'Check your connection and try again.'}
        </p>
        <Link href={user ? '/feed' : '/'} className="ea-cta inline-flex items-center justify-center rounded-lg px-4 py-2 font-semibold min-h-[44px]">
          {user ? 'Back to feed' : 'Sign in'}
        </Link>
      </div>
    );
  }
  return (
    <ActivityBody
      activity={load.activity}
      athlete={load.athlete}
      unit={unit}
      onUnit={chooseUnit}
      hover={hover}
      onHover={setHover}
      onChanged={a => setLoad({ state: 'ready', activity: { ...load.activity, ...a }, athlete: load.athlete })}
    />
  );
}

function ActivityBody({
  activity: a,
  athlete,
  unit,
  onUnit,
  hover,
  onHover,
  onChanged,
}: {
  activity: ActivityDetailView;
  athlete: Athlete | null;
  unit: DistanceUnit;
  onUnit: (u: DistanceUnit) => void;
  hover: number | null;
  onHover: (i: number | null) => void;
  onChanged: (a: Partial<ActivityDetailView>) => void;
}) {
  const def = ACTIVITY_TYPE_DEFS[a.type];
  const pace = formatPace(a.distanceM, a.movingS ?? a.elapsedS, a.type, unit);
  const series = useMemo(() => chartSeries(a.stream, a.type, unit), [a.stream, a.type, unit]);
  const splitRows = useMemo(() => (a.stream ? splits(a.stream, unit) : []), [a.stream, unit]);
  // Owners (and guardians) manage from the in-app profile; everyone else
  // arrives where profile links land — /u/ when there is a handle.
  const profileHref = !athlete
    ? '/feed'
    : !a.owner && athlete.handle
      ? `/u/${athlete.handle}?tab=activities`
      : `/athlete/${athlete.id}?tab=activities`;
  const showMap = a.hasRoute && !!a.stream?.lat && !!a.stream?.lng;

  const stats: { label: string; value: string }[] = [
    { label: 'Distance', value: formatDistance(a.distanceM, unit) },
    { label: 'Moving time', value: formatDuration(a.movingS ?? a.elapsedS) },
    pace,
    { label: 'Elevation gain', value: formatElevation(a.elevGainM, unit) },
  ];
  if (a.movingS !== null && a.elapsedS - a.movingS > 60) stats.push({ label: 'Elapsed time', value: formatDuration(a.elapsedS) });
  if (a.avgHr !== null) stats.push({ label: 'Avg heart rate', value: `${a.avgHr} bpm` });
  if (a.maxHr !== null) stats.push({ label: 'Max heart rate', value: `${a.maxHr} bpm` });
  if (a.avgPower !== null) stats.push({ label: 'Avg power', value: `${a.avgPower} W` });
  if (a.calories !== null) stats.push({ label: 'Calories', value: `${a.calories}` });

  return (
    <article className="space-y-6" data-activity={a.id}>
      <header className="space-y-2">
        <Link href={profileHref} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg min-h-[44px]">
          <i className="fas fa-arrow-left" aria-hidden="true" />
          {athlete ? athlete.name : 'Back'}
        </Link>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-fg text-xl" aria-hidden="true">
            <i className={`fas fa-${def.icon}`} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-[32px] font-bold text-primary break-words" data-activity-name>
              {a.name}
            </h1>
            <p className="text-sm text-secondary">
              {def.label} · {formatStart(a.startedAt, a.timezone)}
              {a.credit && <span data-activity-credit> · {a.credit}</span>}
              {a.owner?.onlyMe && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-secondary"><i className="fas fa-lock" aria-hidden="true" /> Only me</span>}
            </p>
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-activity-stats>
        {stats.map(s => (
          <div key={s.label} className="ea-surface rounded-lg p-3">
            <dt className="text-xs font-semibold text-muted">{s.label}</dt>
            <dd className="text-lg font-bold text-primary tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {showMap && <RouteMap lat={a.stream!.lat!} lng={a.stream!.lng!} showEnds={!!a.owner} highlightIndex={hover} />}
      {!a.owner && a.hasRoute && (
        <p className="text-xs text-muted -mt-4">The first and last part of every route stay private to the athlete.</p>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary">Details</h2>
        <div className="inline-flex rounded-full border border-border p-0.5" role="group" aria-label="Distance unit">
          {(['km', 'mi'] as const).map(u => (
            <button
              key={u}
              type="button"
              onClick={() => onUnit(u)}
              aria-pressed={unit === u}
              className={`rounded-full px-3 py-1 text-sm font-semibold min-h-[36px] min-w-[44px] ${unit === u ? 'bg-brand text-white' : 'text-secondary'}`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {series.map(s => (
        <ActivityStreamChart
          key={s.kind}
          series={s}
          hoverIndex={hover}
          onHover={onHover}
          formatX={m => formatDistance(m, unit)}
          formatY={v =>
            s.kind === 'hr'
              ? `${Math.round(v)} bpm`
              : s.kind === 'elevation'
                ? `${Math.round(v)} ${unit === 'mi' ? 'ft' : 'm'}`
                : ACTIVITY_TYPE_DEFS[a.type].paceStyle === 'speed'
                  ? `${v.toFixed(1)} ${unit === 'km' ? 'km/h' : 'mph'}`
                  : `${formatDuration(v)} /${ACTIVITY_TYPE_DEFS[a.type].paceStyle === 'swim_pace' ? '100m' : unit}`
          }
        />
      ))}

      {splitRows.length > 1 && (
        <section className="ea-surface rounded-lg p-4 overflow-x-auto" data-activity-splits>
          <h3 className="text-sm font-semibold text-primary mb-2">Splits</h3>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-semibold">{unit}</th>
                <th className="py-1 pr-3 font-semibold">Time</th>
                <th className="py-1 pr-3 font-semibold">{ACTIVITY_TYPE_DEFS[a.type].paceStyle === 'speed' ? 'Speed' : 'Pace'}</th>
                <th className="py-1 pr-3 font-semibold">Elev</th>
                {splitRows.some(r => r.avgHr !== null) && <th className="py-1 font-semibold">HR</th>}
              </tr>
            </thead>
            <tbody>
              {splitRows.map(r => (
                <tr key={r.index} className="border-t border-border-subtle text-primary">
                  <td className="py-1.5 pr-3">{r.index}</td>
                  <td className="py-1.5 pr-3">{formatDuration(r.seconds)}</td>
                  <td className="py-1.5 pr-3">{formatPace(r.distanceM, r.seconds, a.type, unit).value}</td>
                  <td className="py-1.5 pr-3">{r.elevChangeM === null ? '—' : `${r.elevChangeM > 0 ? '+' : ''}${formatElevation(r.elevChangeM, unit)}`}</td>
                  {splitRows.some(x => x.avgHr !== null) && <td className="py-1.5">{r.avgHr ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {a.owner && <OwnerControls activity={a} athlete={athlete} onChanged={onChanged} />}
    </article>
  );
}

function OwnerControls({ activity: a, athlete, onChanged }: { activity: ActivityDetailView; athlete: Athlete | null; onChanged: (a: Partial<ActivityDetailView>) => void }) {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);
  const [type, setType] = useState<ActivityType>(a.type);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [caption, setCaption] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const closeEdit = useCallback(() => {
    setEditing(false);
    setName(a.name);
    setType(a.type);
  }, [a.name, a.type]);
  const editGuard = useDirtyClose(() => editing && (name.trim() !== a.name || type !== a.type), closeEdit);
  const closeShare = useCallback(() => {
    setSharing(false);
    setCaption('');
  }, []);
  const shareGuard = useDirtyClose(() => sharing && caption.trim().length > 0, closeShare);

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(`/api/activities/${a.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Not saved', typeof json.error === 'string' ? json.error : 'Please try again.');
        return false;
      }
      onChanged(json.activity);
      return true;
    } catch {
      showError('Not saved', 'Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postType: 'general',
          caption: caption.trim(),
          visibility: 'public',
          stats_data: { type: 'activity', activity_id: a.id },
          // Self, or the athlete a guardian manages — the server's acting gate decides.
          targetProfileId: a.profileId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Not shared', typeof json.error === 'string' ? json.error : 'Please try again.');
        return;
      }
      const post = json.post ?? json;
      onChanged({ postId: (post?.id as string | undefined) ?? 'shared' });
      closeShare();
      showSuccess(post?.status === 'pending_approval' ? 'Sent for approval' : 'Shared to your feed');
    } catch {
      showError('Not shared', 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/activities/${a.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showError('Not deleted', typeof json.error === 'string' ? json.error : 'Please try again.');
        return;
      }
      showSuccess('Activity deleted');
      router.push(`/athlete/${athlete?.id ?? a.profileId}?tab=activities`);
    } catch {
      showError('Not deleted', 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ea-surface rounded-lg p-4 space-y-4" data-activity-owner>
      <h2 className="text-lg font-bold text-primary">Your activity</h2>

      {editing ? (
        <form
          className="space-y-3"
          onSubmit={async e => {
            e.preventDefault();
            if (await patch({ name: name.trim(), type })) setEditing(false);
          }}
        >
          <label className="block">
            <span className="text-sm font-semibold text-secondary">Name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={120}
              required
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-primary"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-secondary">Type</span>
            <select
              value={type}
              onChange={e => setType(e.target.value as ActivityType)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-primary"
            >
              {ACTIVITY_TYPES.map(t => (
                <option key={t} value={t}>
                  {ACTIVITY_TYPE_DEFS[t].label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-3">
            <button type="submit" disabled={busy || !name.trim()} className="ea-cta rounded-lg px-4 py-2 font-semibold min-h-[44px] disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={editGuard.requestClose} className="ea-interactive rounded-lg px-4 py-2 font-semibold text-secondary min-h-[44px]">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setEditing(true)} className="ea-interactive rounded-lg border border-border px-4 py-2 font-semibold text-primary min-h-[44px]">
            <i className="fas fa-pen mr-2" aria-hidden="true" />
            Edit
          </button>
          {a.postId ? (
            <span className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-success-fg min-h-[44px]">
              <i className="fas fa-check mr-2" aria-hidden="true" />
              On your feed
            </span>
          ) : (
            !a.owner?.onlyMe && (
              <button type="button" onClick={() => setSharing(true)} className="ea-interactive rounded-lg border border-border px-4 py-2 font-semibold text-primary min-h-[44px]" data-activity-share>
                <i className="fas fa-share-from-square mr-2" aria-hidden="true" />
                Share to feed
              </button>
            )
          )}
          <button
            type="button"
            disabled={busy || (!a.owner?.onlyMe && !!a.postId)}
            onClick={() => void patch({ onlyMe: !a.owner?.onlyMe })}
            title={!a.owner?.onlyMe && a.postId ? 'Delete the feed post first' : undefined}
            className="ea-interactive rounded-lg border border-border px-4 py-2 font-semibold text-primary min-h-[44px] disabled:opacity-50"
            data-activity-only-me
          >
            <i className={`fas ${a.owner?.onlyMe ? 'fa-lock-open' : 'fa-lock'} mr-2`} aria-hidden="true" />
            {a.owner?.onlyMe ? 'Show on my profile' : 'Only me'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className="ea-interactive rounded-lg border border-danger-border px-4 py-2 font-semibold text-danger-fg min-h-[44px]">
            <i className="fas fa-trash mr-2" aria-hidden="true" />
            Delete
          </button>
        </div>
      )}

      {sharing && (
        <div className="space-y-3 border-t border-border-subtle pt-4" data-activity-share-panel>
          <label className="block">
            <span className="text-sm font-semibold text-secondary">Say something (optional)</span>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={3}
              maxLength={2000}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-primary"
            />
          </label>
          <div className="flex gap-3">
            <button type="button" disabled={busy} onClick={() => void share()} className="ea-cta rounded-lg px-4 py-2 font-semibold min-h-[44px] disabled:opacity-50" data-activity-share-post>
              Post
            </button>
            <button type="button" onClick={shareGuard.requestClose} className="ea-interactive rounded-lg px-4 py-2 font-semibold text-secondary min-h-[44px]">
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this activity?"
        message={`Its route and numbers${a.postId ? ' and its feed post' : ''} will be removed. This can’t be undone.`}
        confirmText="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmModal
        isOpen={editGuard.confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={editGuard.confirmDiscard}
        onCancel={editGuard.cancelDiscard}
      />
      <ConfirmModal
        isOpen={shareGuard.confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={shareGuard.confirmDiscard}
        onCancel={shareGuard.cancelDiscard}
      />
    </section>
  );
}
