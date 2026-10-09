'use client';

// /activities/[id] — an activity as a place. Everything shown is what the
// server's projection sent THIS viewer (visibility.ts): the owner's whole
// route and controls, a viewer's trimmed route, or — for a supervised
// athlete's viewers — no map at all, only the numbers and charts. The page
// never re-derives privacy. Never a dead end: the athlete's profile link
// and the header are always there; a refusal is the house not-found.

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import CaptureInputs from '@/components/media/CaptureInputs';
import MediaTile from '@/components/media/MediaTile';
import { uploadPostMedia } from '@/lib/media/upload';
import { validateFiles } from '@/lib/media/validation';
import { MAX_UPLOAD_BYTES } from '@/lib/media/upload-rules';
import { SEGMENT_KIND_LABELS, SEGMENT_KINDS, SEGMENT_MAX, SEGMENT_MIN_S, type ActivitySegment, type SegmentKind } from '@/lib/activities/segments';
import { ACTIVITY_MEDIA_MAX } from '@/lib/activities/media';
import { sportForActivity } from '@/lib/activities/sport-bridge';
import { isSportEnabled } from '@/lib/features';
import { getSportDefinition } from '@/lib/sports/SportRegistry';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
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
import { segmentStats, splits } from '@/lib/activities/stream';
import type { ActivityDetailView, ActivityMediaView } from '@/lib/activities/visibility';
import ActivityStreamChart from './ActivityStreamChart';
import RouteMap from './RouteMap';
import RouteThumb from './RouteThumb';
import { prefersReducedData } from '@/lib/net/reduced-data';

// The shared media editor (the pencil on a photo) — loaded only when opened.
const MediaEditor = dynamic(() => import('@/components/media-editor').then(m => m.MediaEditor), { ssr: false });
const PHOTO_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5'],
  allowVideo: true,
  maxAssets: 1,
  output: { maxDimension: 2048, mime: 'image/jpeg', quality: 0.9 },
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
/** "m:ss" or "h:mm:ss" or plain seconds → seconds, else null. */
function parseMmss(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

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
  // After a photo changes, the whole view is re-read (the PATCH answers no media).
  const reload = useCallback(async () => {
    const next = await fetchActivity();
    if (next.state === 'ready') setLoad(next);
  }, [fetchActivity]);

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
      onReload={reload}
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
  onReload,
}: {
  activity: ActivityDetailView;
  athlete: Athlete | null;
  unit: DistanceUnit;
  onUnit: (u: DistanceUnit) => void;
  hover: number | null;
  onHover: (i: number | null) => void;
  onChanged: (a: Partial<ActivityDetailView>) => void;
  onReload: () => Promise<void>;
}) {
  const def = ACTIVITY_TYPE_DEFS[a.type];
  // Live Activities (251): the segments' measures from THIS viewer's stream, a tapped one highlighted.
  const segmentRows = useMemo(
    () => (a.stream ? a.segments.map(seg => ({ seg, stat: segmentStats(a.stream!, seg) })) : a.segments.map(seg => ({ seg, stat: null }))),
    [a.stream, a.segments]
  );
  const [picked, setPicked] = useState<string | null>(null);
  // Save-Data / reduced-data, read once when the screen mounts (client-only —
  // the page's server render is a shell, so there is no hydration to mismatch).
  const [reducedData] = useState(() => prefersReducedData());
  const [liveMap, setLiveMap] = useState(false);
  const highlightRange = useMemo<[number, number] | null>(() => {
    const row = segmentRows.find(r => r.seg.id === picked);
    return row?.stat ? [row.stat.startIndex, row.stat.endIndex] : null;
  }, [segmentRows, picked]);
  const pins = useMemo(() => a.media.filter(m => m.pin).map(m => ({ id: m.id, at: m.pin as [number, number] })), [a.media]);
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
  // The live map waits for a tap under Save-Data; without a preview to show
  // instead, the map it is.
  const staticRoute = reducedData && !liveMap && !!a.routePreview;

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
  if (a.steps !== null) stats.push({ label: a.stepsSource === 'device' ? 'Steps' : 'Steps (est.)', value: `~${a.steps.toLocaleString()}` });

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

      {showMap && staticRoute && (
        // Save-Data / reduced-data (Oct 9 2026): the route's line drawing — the
        // same picture the feed shows — instead of a tiled map, until asked.
        <div
          className="relative h-64 sm:h-80 w-full rounded-lg border border-border overflow-hidden bg-surface-sunken text-brand-fg-strong p-6 flex items-center justify-center"
          data-route-static=""
        >
          <RouteThumb preview={a.routePreview} className="h-full w-full" w={320} h={180} />
          <button
            type="button"
            onClick={() => setLiveMap(true)}
            className="absolute bottom-2 right-2 z-10 rounded-full bg-surface/95 px-3 py-1.5 text-sm font-semibold text-primary shadow-md border border-border min-h-[36px]"
            data-route-show-map=""
          >
            Show map
          </button>
        </div>
      )}
      {showMap && !staticRoute && (
        <RouteMap lat={a.stream!.lat!} lng={a.stream!.lng!} showEnds={!!a.owner} highlightIndex={hover} highlightRange={highlightRange} pins={pins} />
      )}
      {a.notes && (
        <p className="whitespace-pre-wrap text-base text-primary" data-activity-notes>
          {a.notes}
        </p>
      )}
      {a.media.length > 0 && (
        <section data-activity-photos={a.media.length}>
          <h2 className="text-lg font-bold text-primary mb-2">Photos</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {a.media.map(m => (
              <figure key={m.id} className="relative" data-activity-photo={m.id}>
                <MediaTile src={m.mediaUrl} thumbnailUrl={m.thumbnailUrl} kind={m.mediaType} alt={m.caption ?? 'Activity photo'} durationSeconds={m.durationSeconds} className="aspect-square rounded-lg" />
                {(m.caption || m.atS !== null) && (
                  <figcaption className="mt-1 text-xs text-secondary truncate">
                    {m.caption ?? ''}
                    {m.atS !== null && <span className="text-muted">{m.caption ? ' · ' : ''}at {mmss(m.atS)}</span>}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      )}
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
          highlightRange={highlightRange}
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

      {segmentRows.length > 0 && (
        <section className="ea-surface rounded-lg p-4 overflow-x-auto" data-activity-segments={segmentRows.length}>
          <h3 className="text-sm font-semibold text-primary mb-2">Segments <span className="font-normal text-muted">— tap one to see it on the route</span></h3>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-semibold">What</th>
                <th className="py-1 pr-3 font-semibold">When</th>
                <th className="py-1 pr-3 font-semibold">Distance</th>
                <th className="py-1 pr-3 font-semibold">Time</th>
                <th className="py-1 pr-3 font-semibold">{def.paceStyle === 'speed' ? 'Speed' : 'Pace'}</th>
                <th className="py-1 pr-3 font-semibold">Elev</th>
                {segmentRows.some(r => r.stat?.avgHr !== null && r.stat?.avgHr !== undefined) && <th className="py-1 font-semibold">HR</th>}
              </tr>
            </thead>
            <tbody>
              {segmentRows.map(({ seg, stat }) => (
                <tr
                  key={seg.id}
                  onClick={() => setPicked(p => (p === seg.id ? null : seg.id))}
                  aria-selected={picked === seg.id}
                  className={`border-t border-border-subtle text-primary cursor-pointer ${picked === seg.id ? 'bg-brand-soft' : ''}`}
                  data-activity-segment={seg.id}
                >
                  <td className="py-1.5 pr-3 font-medium">{seg.label ?? SEGMENT_KIND_LABELS[seg.kind]}{seg.label && <span className="text-muted"> · {SEGMENT_KIND_LABELS[seg.kind]}</span>}</td>
                  <td className="py-1.5 pr-3">{mmss(seg.from_s)}–{mmss(seg.to_s)}</td>
                  <td className="py-1.5 pr-3">{stat ? formatDistance(stat.distanceM, unit) : '—'}</td>
                  <td className="py-1.5 pr-3">{formatDuration(stat ? stat.seconds : seg.to_s - seg.from_s)}</td>
                  <td className="py-1.5 pr-3">{stat ? formatPace(stat.distanceM, stat.seconds, a.type, unit).value : '—'}</td>
                  <td className="py-1.5 pr-3">{stat?.elevGainM === null || stat?.elevGainM === undefined ? '—' : `+${formatElevation(stat.elevGainM, unit)}`}</td>
                  {segmentRows.some(r => r.stat?.avgHr !== null && r.stat?.avgHr !== undefined) && <td className="py-1.5">{stat?.avgHr ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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

      {a.owner && <OwnerControls activity={a} athlete={athlete} onChanged={onChanged} onReload={onReload} />}
    </article>
  );
}

/** A segment as the editor holds it: times as the athlete types them. */
interface SegmentDraft {
  id: string;
  kind: SegmentKind;
  from: string;
  to: string;
  label: string;
}
const draftOf = (s: ActivitySegment): SegmentDraft => ({ id: s.id, kind: s.kind, from: mmss(s.from_s), to: mmss(s.to_s), label: s.label ?? '' });
const draftId = () => `seg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function OwnerControls({ activity: a, athlete, onChanged, onReload }: { activity: ActivityDetailView; athlete: Athlete | null; onChanged: (a: Partial<ActivityDetailView>) => void; onReload: () => Promise<void> }) {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);
  const [type, setType] = useState<ActivityType>(a.type);
  const [notes, setNotes] = useState(a.notes ?? '');
  const [drafts, setDrafts] = useState<SegmentDraft[]>(() => a.segments.map(draftOf));
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [caption, setCaption] = useState('');
  // The share-time bridge (Oct 4 2026): a ride, run, swim or row may be posted
  // as the SPORT's result instead of the training card — the athlete's choice.
  const sport = sportForActivity(a.type);
  const sportEnabled = sport !== null && isSportEnabled(sport);
  const [shareAs, setShareAs] = useState<'training' | 'sport'>('training');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPhoto, setConfirmPhoto] = useState<ActivityMediaView | null>(null);
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);
  const replacingRef = useRef<ActivityMediaView | null>(null);

  const segmentsDirty = () => JSON.stringify(drafts) !== JSON.stringify(a.segments.map(draftOf));
  const closeEdit = useCallback(() => {
    setEditing(false);
    setName(a.name);
    setType(a.type);
    setNotes(a.notes ?? '');
    setDrafts(a.segments.map(draftOf));
    setSegmentError(null);
  }, [a.name, a.type, a.notes, a.segments]);
  const editGuard = useDirtyClose(() => editing && (name.trim() !== a.name || type !== a.type || notes.trim() !== (a.notes ?? '') || segmentsDirty()), closeEdit);

  /** The drafts as the PATCH wants them — or the first problem, by name. */
  const segmentsFromDrafts = (): { ok: true; segments: ActivitySegment[] } | { ok: false; error: string } => {
    const out: ActivitySegment[] = [];
    for (const d of drafts) {
      const from = parseMmss(d.from);
      const to = parseMmss(d.to);
      if (from === null || to === null) return { ok: false, error: 'A segment needs a start and an end, as m:ss.' };
      if (to - from < SEGMENT_MIN_S) return { ok: false, error: `A segment lasts at least ${SEGMENT_MIN_S} seconds.` };
      if (to > a.elapsedS) return { ok: false, error: `This activity is ${mmss(a.elapsedS)} long — a segment cannot end after that.` };
      const seg: ActivitySegment = { id: d.id, kind: d.kind, from_s: from, to_s: to };
      if (d.label.trim()) seg.label = d.label.trim().slice(0, 40);
      out.push(seg);
    }
    if (out.length > SEGMENT_MAX) return { ok: false, error: `At most ${SEGMENT_MAX} segments.` };
    return { ok: true, segments: out };
  };

  // Photos (251): add through the one upload door, re-edit through the shared editor, remove.
  const attachFiles = async (files: File[]) => {
    const { accepted, rejected } = validateFiles(files, { maxBytes: MAX_UPLOAD_BYTES, allowVideo: true, maxCount: ACTIVITY_MEDIA_MAX, existingCount: a.media.length });
    if (rejected.length > 0) showError('Not added', rejected[0].message);
    if (accepted.length === 0) return;
    setBusy(true);
    try {
      for (const file of accepted) {
        const up = await uploadPostMedia(file, a.profileId);
        const res = await fetch(`/api/activities/${a.id}/media`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_url: up.url, media_type: up.type, targetProfileId: a.profileId }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          showError('Not added', typeof json.error === 'string' ? json.error : 'Please try again.');
        }
      }
      await onReload();
    } catch (e) {
      showError('Not added', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const reEditPhoto = async (m: ActivityMediaView) => {
    setBusy(true);
    try {
      const res = await fetch(m.mediaUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not open the photo');
      const blob = await res.blob();
      const file = new File([blob], `photo.${blob.type.split('/')[1] || 'jpg'}`, { type: blob.type || 'image/jpeg' });
      replacingRef.current = m;
      setEditorAssets([{ id: m.id, file, kind: m.mediaType }]);
    } catch (e) {
      showError('Could not open the photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const editorDone = async (results: EditedMedia[]) => {
    const target = replacingRef.current;
    setEditorAssets(null);
    replacingRef.current = null;
    if (!target || results.length === 0) return;
    setBusy(true);
    try {
      const up = await uploadPostMedia(results[0].file, a.profileId);
      URL.revokeObjectURL(results[0].previewUrl);
      const res = await fetch(`/api/activities/${a.id}/media/${target.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_url: up.url, thumbnail_url: null, targetProfileId: a.profileId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showError('Not saved', typeof json.error === 'string' ? json.error : 'Please try again.');
      }
      await onReload();
    } catch (e) {
      showError('Not saved', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const removePhoto = async (m: ActivityMediaView) => {
    setConfirmPhoto(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/activities/${a.id}/media/${m.id}?targetProfileId=${encodeURIComponent(a.profileId)}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) showError('Not removed', 'Please try again.');
      await onReload();
    } finally {
      setBusy(false);
    }
  };
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
          postType: shareAs === 'sport' && sportEnabled ? sport : 'general',
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
      showSuccess(
        post?.status === 'pending_approval' ? 'Sent for approval' : shareAs === 'sport' && sportEnabled ? `Posted as a ${getSportDefinition(sport!).display_name} result` : 'Shared to your feed'
      );
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
            const segs = segmentsFromDrafts();
            if (!segs.ok) {
              setSegmentError(segs.error);
              return;
            }
            setSegmentError(null);
            if (await patch({ name: name.trim(), type, notes: notes.trim() || null, segments: segs.segments })) setEditing(false);
          }}
          data-activity-edit-form
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
          <label className="block">
            <span className="text-sm font-semibold text-secondary">Notes</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
              placeholder="How it went, who you were with…"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-primary"
              data-activity-notes-input
            />
          </label>
          <fieldset className="space-y-2" data-activity-segments-editor>
            <legend className="text-sm font-semibold text-secondary">Segments <span className="font-normal text-muted">— sprints, climbs, intervals; times as m:ss</span></legend>
            {drafts.map((d, i) => (
              <div key={d.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end" data-activity-segment-row>
                <label className="block col-span-4 sm:col-span-1">
                  <span className="text-xs text-muted">Kind</span>
                  <select value={d.kind} onChange={e => setDrafts(ds => ds.map((x, j) => (j === i ? { ...x, kind: e.target.value as SegmentKind } : x)))} className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm text-primary min-h-[44px]">
                    {SEGMENT_KINDS.map(k => (
                      <option key={k} value={k}>{SEGMENT_KIND_LABELS[k]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted">From</span>
                  <input value={d.from} onChange={e => setDrafts(ds => ds.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} inputMode="numeric" placeholder="m:ss" className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm text-primary min-h-[44px] tabular-nums" aria-label="Segment start" />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">To</span>
                  <input value={d.to} onChange={e => setDrafts(ds => ds.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} inputMode="numeric" placeholder="m:ss" className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm text-primary min-h-[44px] tabular-nums" aria-label="Segment end" />
                </label>
                <button type="button" onClick={() => setDrafts(ds => ds.filter((_, j) => j !== i))} className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-danger-fg" aria-label="Remove segment">
                  <i className="fas fa-times" aria-hidden="true" />
                </button>
                <label className="block col-span-4">
                  <span className="sr-only">Segment name</span>
                  <input value={d.label} onChange={e => setDrafts(ds => ds.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, 40) } : x)))} placeholder="A name (optional)" className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
                </label>
              </div>
            ))}
            {drafts.length < SEGMENT_MAX && (
              <button type="button" onClick={() => setDrafts(ds => [...ds, { id: draftId(), kind: 'interval', from: '', to: '', label: '' }])} className="ea-interactive rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary min-h-[44px]" data-activity-segment-add>
                <i className="fas fa-plus mr-2" aria-hidden="true" />
                Add a segment
              </button>
            )}
            {segmentError && <p className="text-sm text-danger-fg" role="alert">{segmentError}</p>}
          </fieldset>
          <div className="flex gap-3">
            <button type="submit" disabled={busy || !name.trim()} className="ea-cta rounded-lg px-4 py-2 font-semibold min-h-[44px] disabled:opacity-50" data-activity-edit-save>
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

      <div className="space-y-2 border-t border-border-subtle pt-4" data-activity-photo-controls>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-secondary mr-1">Photos</span>
          <CaptureInputs onFiles={files => void attachFiles(Array.from(files))} allowVideo>
            {({ openPhoto }) => (
              <button type="button" disabled={busy || a.media.length >= ACTIVITY_MEDIA_MAX} onClick={openPhoto} className="ea-interactive rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary min-h-[44px] disabled:opacity-50">
                <i className="fas fa-camera mr-2" aria-hidden="true" />
                Take a photo
              </button>
            )}
          </CaptureInputs>
          <label className={`ea-interactive inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary min-h-[44px] cursor-pointer ${busy || a.media.length >= ACTIVITY_MEDIA_MAX ? 'opacity-50 pointer-events-none' : ''}`}>
            <i className="fas fa-images mr-2" aria-hidden="true" />
            Add from library
            <input type="file" accept="image/*,video/*" multiple className="sr-only" onChange={e => { const f = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; void attachFiles(f); }} data-activity-photo-input />
          </label>
        </div>
        {a.media.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {a.media.map(m => (
              <li key={m.id} className="flex items-center gap-1 rounded-lg bg-surface-muted px-2 py-1 text-xs text-secondary" data-activity-photo-row={m.id}>
                <span className="max-w-[9rem] truncate">{m.caption ?? (m.atS !== null ? `at ${mmss(m.atS)}` : m.mediaType)}</span>
                <button type="button" disabled={busy} onClick={() => void reEditPhoto(m)} className="ea-icon-btn inline-flex items-center justify-center text-brand-fg" aria-label="Edit photo">
                  <i className="fas fa-pen text-xs" aria-hidden="true" />
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmPhoto(m)} className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-danger-fg" aria-label="Remove photo">
                  <i className="fas fa-times text-xs" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editorAssets && <MediaEditor assets={editorAssets} config={PHOTO_EDITOR_CONFIG} onDone={editorDone} onCancel={() => { setEditorAssets(null); replacingRef.current = null; }} />}

      <ConfirmModal
        isOpen={confirmPhoto !== null}
        title="Remove this photo?"
        message="It leaves the activity. A copy already on your feed post stays there."
        confirmText="Remove"
        onConfirm={() => confirmPhoto && void removePhoto(confirmPhoto)}
        onCancel={() => setConfirmPhoto(null)}
      />

      {sharing && (
        <div className="space-y-3 border-t border-border-subtle pt-4" data-activity-share-panel>
          {sportEnabled && (
            <fieldset className="space-y-2" data-activity-share-as={shareAs}>
              <legend className="text-sm font-semibold text-secondary">Post it as</legend>
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer min-h-[44px]">
                <input type="radio" name="share-as" value="training" checked={shareAs === 'training'} onChange={() => setShareAs('training')} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary">Training</span>
                  <span className="block text-xs text-muted">The activity card — route, distance, time, pace.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer min-h-[44px]">
                <input type="radio" name="share-as" value="sport" checked={shareAs === 'sport'} onChange={() => setShareAs('sport')} className="mt-1" data-activity-share-as-sport />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary">A {getSportDefinition(sport!).display_name} result</span>
                  <span className="block text-xs text-muted">A stat line in your {getSportDefinition(sport!).display_name} tab — distance, time, pace, heart rate — and your performance record.</span>
                </span>
              </label>
            </fieldset>
          )}
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
