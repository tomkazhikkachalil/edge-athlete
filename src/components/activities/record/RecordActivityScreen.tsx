'use client';

/**
 * /activities/record — the recorder (Live Activities, Oct 4 2026). Tom: a
 * walk, a run, a ride … recorded live from the phone — a timer, GPS, a map,
 * segments marked on the way, photos as tiles — into the Activities pipeline
 * (never a workout). This screen OWNS NO RULE AND NO ENGINE: the state
 * machine is record/recording.ts (pure, tested), the persistence
 * record/storage.ts, and since the resume pill program (Oct 12 2026) the
 * running engine — events, GPS, wake lock, flushes, photo uploads — lives
 * under the app's root (RecordingProvider / RecordingEngineHost), so leaving
 * this screen changes nothing: the recording goes on while you read the feed
 * and the resume pill brings you back. This is a VIEW over useRecording().
 *
 * Facts, plainly: a web page gets GPS only while the APP is open with the
 * screen on (a wake lock keeps it on where the browser has one; a hidden
 * page or a closed app opens a gap that is shown on return — a note here, a
 * dashed line on the map); steps are an estimate labelled "est."; the
 * server recomputes every number at Save.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { backOr } from '@/lib/nav-back';
import { ACTIVITY_TYPE_DEFS, type ActivityType } from '@/lib/activities/catalog';
import type { ActivityPoint } from '@/lib/activities/types';
import { defaultActivityName } from '@/lib/activities/normalize';
import { readUnitPreference } from '@/lib/activities/format';
import { elapsedS, recordingAnswers, recordsGpsFor, toRecordingWire, type RecordingState } from '@/lib/activities/record/recording';
import { recordLayout, type LivePanel } from '@/lib/activities/record/layout';
import { armBell } from '@/lib/activities/record/bell';
import { detailLine, type Details } from '@/lib/activities/details';
import { unitSystemOf } from '@/lib/activities/units';
import SetupCard from './SetupCard';
import DetailsSheet from './DetailsSheet';
import LengthsCounter from './LengthsCounter';
import { hasWakeLock } from '@/lib/device/wake-lock';
import { queryGeoPermission } from '@/lib/activities/record/geolocation';
import type { SegmentKind } from '@/lib/activities/segments';
import { useRecording } from './RecordingProvider';
import TypePicker from './TypePicker';
import LiveStats from './LiveStats';
import LiveRouteMap from './LiveRouteMap';
import RecorderControls from './RecorderControls';
import SegmentSheet from './SegmentSheet';
import RoundTimerPanel from './RoundTimerPanel';
import ClimbLog from '@/components/activities/ClimbLog';
import { useStartWorkout } from '@/hooks/useStartWorkout';
import { finishPayload } from '@/components/activities/FinishDetailsForm';
import RecorderPhotos from './RecorderPhotos';
import FinishSheet, { type FinishDetails } from './FinishSheet';
import { postActivity } from '@/lib/activities/share-client';
import { sportForActivity } from '@/lib/activities/sport-bridge';
import { isSportEnabled } from '@/lib/features';
import { COPY } from '@/lib/copy';
import type { LatLng } from '@/lib/activities/polyline';

const EMPTY_ROUTE: ActivityPoint[] = [];

const localZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

const GPS_NOTE = 'GPS records only while the screen is on and this app is in front — leaving this page is fine, closing the app is a gap.';

export default function RecordActivityScreen() {
  const router = useRouter();
  const { user, profile, initialAuthCheckComplete, activeProfile } = useAuth();
  const { showError, showNotice } = useToast();
  const rec = useRecording();
  const engine = rec.engine;
  const state: RecordingState | null = engine?.state ?? null;
  const targetProfileId = activeProfile?.id ?? null;
  const heightCm = (() => {
    const h = (activeProfile ?? profile) as { height_cm?: unknown } | null;
    return typeof h?.height_cm === 'number' ? h.height_cm : null;
  })();

  const [now, setNow] = useState(() => Date.now());
  const [segmentSheet, setSegmentSheet] = useState<{ endedAt: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [geoPermission, setGeoPermission] = useState<PermissionState | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Program E: the Details sheet (effort, notes, the type's questions) while recording.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The recorder is mid-start: the engine chunk is loading (a first start).
  // Cleared by the handlers that empty the state (Discard, "Choose another").
  const [startingType, setStartingType] = useState<ActivityType | null>(null);
  const starting = startingType !== null && !state;
  const unit = useMemo(() => readUnitPreference(), []);

  useEffect(() => {
    if (initialAuthCheckComplete && !user) router.replace('/');
  }, [initialAuthCheckComplete, user, router]);

  useEffect(() => {
    let cancelled = false;
    void queryGeoPermission().then(p => {
      if (!cancelled) setGeoPermission(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The clock: a re-render a second while something is running (the elapsed
  // time is derived from timestamps, never counted — iOS throttles timers).
  const running = state?.status === 'recording' || state?.status === 'paused';
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // ?finish=1 (the reopen prompt's Finish, the Drafts list): finish the
  // restored recording as soon as it is in and open the review.
  const wantsFinishRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (wantsFinishRef.current === null) {
      try {
        wantsFinishRef.current = new URLSearchParams(window.location.search).get('finish') === '1';
        if (wantsFinishRef.current) window.history.replaceState(null, '', window.location.pathname);
      } catch {
        wantsFinishRef.current = false;
      }
    }
    if (!wantsFinishRef.current || !engine || !state) return;
    if (state.status === 'recording' || state.status === 'paused') {
      wantsFinishRef.current = false;
      const t = setTimeout(() => engine.dispatch({ type: 'finish', now: Date.now() }), 0);
      return () => clearTimeout(t);
    }
    if (state.status === 'finished') wantsFinishRef.current = false;
  }, [engine, state]);

  const dispatch = engine?.dispatch ?? (() => undefined);
  // A10: the picker's "Strength training" opens the Workout's start screen (E2).
  // Workouts are the athlete's own (a guardian acting for an athlete records activities only).
  const ownWorkouts = !!user && (!targetProfileId || targetProfileId === user.id);
  const startWorkout = useStartWorkout(ownWorkouts);

  const onMark = () => {
    const s = engine?.getState();
    if (!s || s.status !== 'recording') return;
    const at = Date.now();
    if (s.openSegmentFromS === null) dispatch({ type: 'markStart', now: at });
    else setSegmentSheet({ endedAt: at });
  };
  const endSegment = (kind: SegmentKind, label: string | null) => {
    const sheet = segmentSheet;
    setSegmentSheet(null);
    if (!sheet) return;
    dispatch({ type: 'markEnd', now: sheet.endedAt, kind, label, id: `seg-${sheet.endedAt}` });
  };

  const onFinish = () => dispatch({ type: 'finish', now: Date.now() });

  const save = async ({ name, manualDistanceM, onFeed, caption, sport, answers }: FinishDetails) => {
    const s0 = engine?.getState();
    if (!engine || !s0 || s0.status !== 'finished') return;
    setSaving(true);
    setSaveError(null);
    dispatch({ type: 'setName', name });
    if (manualDistanceM !== null) dispatch({ type: 'setManualDistance', distanceM: manualDistanceM });
    try {
      await engine.uploadsSettled();
      const latest = engine.getState() ?? s0;
      const trimmedName = name && name.trim() ? name.trim().slice(0, 120) : null;
      const wire = toRecordingWire({ ...latest, name: trimmedName, manualDistanceM: manualDistanceM ?? latest.manualDistanceM }, localZone());
      const res = await fetch('/api/activities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // The row IS the profile presence (Training); the feed is a separate switch below.
        body: JSON.stringify({
          activity: wire,
          finish: finishPayload(answers),
          ...(targetProfileId ? { targetProfileId } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error || 'Could not save the activity.');
      for (const p of latest.photos) {
        if (!p.url) continue;
        await fetch(`/api/activities/${json.id}/media`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_url: p.url, media_type: p.type, at_s: p.atS, ...(targetProfileId ? { targetProfileId } : {}) }),
        }).catch(() => undefined);
      }
      await engine.clear();
      if (onFeed) {
        // The activity is saved either way; a failed post leaves it on its
        // page, where "Post to feed" still offers it.
        const posted = await postActivity({ activityId: json.id, sport, caption, targetProfileId });
        if (!posted.ok) showError('Saved — not posted', `${posted.error} You can share it from this page.`);
        else if (posted.pendingApproval) showNotice('Sent for approval');
      }
      router.push(`/activities/${json.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the activity.');
      setSaving(false);
    }
  };
  const dropFailed = () => {
    const s = engine?.getState();
    if (!s || !engine) return;
    for (const p of s.photos) if (p.failed) engine.removePhoto(p.localId);
  };
  const discard = async () => {
    await engine?.clear();
    setStartingType(null);
    setDiscardOpen(false);
    setSaving(false);
    setSaveError(null);
  };

  const totals = engine && state ? engine.totals(now, heightCm) : null;
  const drawnRoute = engine?.drawnRoute ?? EMPTY_ROUTE;
  const lastFix = state?.points[state.points.length - 1];
  const stale = !!lastFix && state?.status === 'recording' && now - lastFix.t > 20_000;
  const def = state ? ACTIVITY_TYPE_DEFS[state.type] : null;
  const gpsType = !!state && recordsGpsFor(state);
  // The review (FinishSheet): the drawn route, the sport it may be posted as,
  // and the POSTING account's privacy — the athlete a guardian acts for, else self.
  const reviewRoute = useMemo<LatLng[]>(
    () => drawnRoute.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number').map(p => [p.lat as number, p.lng as number]),
    [drawnRoute]
  );
  const geoNote =
    geoPermission === 'denied' ? 'Location is OFF for Edge Athlete — allow it in your phone’s settings first.' : geoPermission === 'prompt' || geoPermission === null ? 'Your phone will ask to use your location when you start.' : '';
  const bridged = state ? sportForActivity(state.type) : null;
  const sportOption = bridged && isSportEnabled(bridged) ? bridged : null;
  const accountVisibility = (activeProfile ?? profile)?.visibility ?? null;
  const gapNotice = engine?.gapNotice ?? null;

  // The last session's CHOICES land in the recording ONCE, as soon as it
  // exists (Program E — the set-up card shows them pre-chosen; until Oct 20
  // 2026 they arrived only at the Finish). Read from the server so they
  // follow the athlete across devices; a failure still marks the recording
  // prefilled (with nothing) so nothing asks twice.
  const prefillFor = state && !state.prefilled ? state.id : null;
  const prefillType = state?.type ?? null;
  useEffect(() => {
    if (!prefillFor || !prefillType || !engine) return;
    let cancelled = false;
    const q = new URLSearchParams({ type: prefillType, ...(targetProfileId ? { targetProfileId } : {}) });
    fetch(`/api/activities/last-details?${q}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { details: {} }))
      .then((j: { details?: Details }) => {
        if (!cancelled) engine.dispatch({ type: 'prefill', details: j.details ?? {} });
      })
      .catch(() => {
        if (!cancelled) engine.dispatch({ type: 'prefill', details: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [prefillFor, prefillType, targetProfileId, engine]);
  const layout = state ? recordLayout(state.type) : null;
  const answers = state ? recordingAnswers(state) : null;
  const setupLine = state && answers ? detailLine(state.type, answers.details, unitSystemOf(unit)) : null;

  if (!initialAuthCheckComplete || !user) return null;

  return (
    <div className="min-h-screen bg-canvas pb-28" data-record-screen={state?.status ?? (rec.ready && !starting ? 'pick' : 'loading')}>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface/95 px-2 py-2 backdrop-blur pt-[calc(0.5rem+env(safe-area-inset-top))]">
        {/* Leaving changes nothing: the recording goes on under the app's root (the pill brings you back). */}
        <button type="button" onClick={() => backOr(router, '/athlete?tab=activities')} className="ea-icon-btn inline-flex items-center justify-center text-primary" aria-label="Back" data-record-back="">
          <i className="fas fa-arrow-left text-lg" aria-hidden="true"></i>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-base font-bold text-primary">{def ? `Record · ${def.label}` : 'Record an activity'}</h1>
          {setupLine && state?.status !== 'finished' && <p className="truncate text-xs text-secondary" data-record-setup-line="">{setupLine}</p>}
        </div>
        {running && gpsType && engine && (
          <span className="text-xs text-muted" aria-live="polite" data-record-gps-state={totals?.gpsSettling ? 'settling' : 'tracking'}>
            {totals?.gpsSettling ? 'Finding GPS…' : engine.wakeHeld ? 'Screen stays on' : hasWakeLock() ? '' : 'Keep your screen on'}
          </span>
        )}
      </header>

      {!state && rec.ready && !starting && (
        <main className="mx-auto max-w-xl px-4 py-4">
          <p className="mb-4 text-sm text-secondary">
            Pick what you are about to do. Edge Athlete records only while this app is open with the screen on — any page of it; the screen stays awake where your phone allows it. Recording with the phone locked comes with the Edge Athlete app — for now keep the app open. Steps are an estimate.
          </p>
          <TypePicker
            onStrength={ownWorkouts ? () => startWorkout.open() : undefined}
            onPick={type => {
              setStartingType(type);
              rec.start(type);
            }}
          />
        </main>
      )}
      {!state && (!rec.ready || starting) && (
        <div className="flex justify-center py-16" data-record-loading="">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-label="Loading" />
        </div>
      )}

      {state && def && totals && engine && (
        <main className="mx-auto max-w-xl">
          {state.status === 'idle' && layout && (
            <SetupCard
              state={state}
              layout={layout}
              unit={unit}
              gpsType={gpsType}
              gpsNote={GPS_NOTE}
              geoNote={geoNote}
              dispatch={dispatch}
              onChooseAnother={() => {
                setStartingType(null);
                void engine.clear();
              }}
              onIndoorTwin={twin => {
                // The engine's start clears this set-up's row first (E1a).
                setStartingType(twin);
                rec.start(twin);
              }}
            />
          )}
          {gapNotice && state.status !== 'finished' && (
            <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-record-gap-note={gapNotice.seconds}>
              <p>
                <span className="font-semibold">{COPY.FORMS.RECORD_GAP_TITLE}</span> {COPY.FORMS.RECORD_GAP_BODY(gapNotice.seconds)}
              </p>
              <button type="button" onClick={engine.dismissGapNotice} className="ea-icon-btn inline-flex shrink-0 items-center justify-center" aria-label="Dismiss" data-record-gap-dismiss="">
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
          )}
          {layout && state.status !== 'idle' && layout.live.map((panel: LivePanel) => {
            const live = state.status === 'recording' || state.status === 'paused';
            switch (panel) {
              case 'map':
                return gpsType ? (
                  <LiveRouteMap
                    key="map"
                    points={drawnRoute}
                    startedAt={state.startedAt}
                    segments={state.segments}
                    openSegmentFromS={state.openSegmentFromS}
                    photos={state.photos.map(p => ({ localId: p.localId, atS: p.atS }))}
                    accuracy={engine.lastAccuracy}
                    gaps={state.gaps}
                  />
                ) : null;
              case 'stats':
                return (
                  <div key="stats" className="mt-4">
                    <LiveStats type={state.type} totals={totals} unit={unit} gps={gpsType ? { status: engine.geoStatus, accuracy: engine.lastAccuracy, stale } : null} line={layout.calm ? setupLine : null} stats={layout.liveStats} />
                  </div>
                );
              case 'climbs':
                return state.type === 'climb' && live ? (
                  // A8: each climb is logged as it happens — in the stored recording at once.
                  <div key="climbs" className="mx-4 mt-4 rounded-xl border border-border bg-surface p-4" data-record-climbs="">
                    <ClimbLog
                      scale={state.climbScale ?? null}
                      climbs={state.climbs ?? []}
                      onScale={scale => dispatch({ type: 'climbScale', scale })}
                      onAdd={climb => dispatch({ type: 'climbLogged', now: Date.now(), climb })}
                      onEdit={(index, climb) => dispatch({ type: 'climbEdited', index, climb })}
                      onRemove={index => dispatch({ type: 'climbRemoved', index })}
                    />
                  </div>
                ) : null;
              case 'timer':
                return live ? (
                  <RoundTimerPanel
                    key="timer"
                    state={state}
                    wakeHeld={engine.wakeHeld}
                    onStart={spec => dispatch({ type: 'timerStart', now: Date.now(), spec })}
                    onStop={() => dispatch({ type: 'timerStop', now: Date.now() })}
                    onAmrapTap={() => dispatch({ type: 'amrapTap', now: Date.now() })}
                  />
                ) : null;
              case 'details':
                // Program E: the answers, any time — the same questions the Finish asks.
                return live ? (
                  <div key="details" className="mx-4 mt-4">
                    <button type="button" onClick={() => setDetailsOpen(true)} className="ea-interactive ea-surface flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm" data-record-details-open="">
                      <i className="fas fa-pen-to-square text-brand-fg" aria-hidden="true"></i>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-primary">Details</span>
                        <span className="block truncate text-xs text-secondary" data-record-details-line="">
                          {[answers?.effort ? `Effort ${answers.effort}` : null, setupLine, answers?.notes.trim() ? 'Notes' : null].filter(Boolean).join(' · ') || 'Add effort, notes and more'}
                        </span>
                      </span>
                      <i className="fas fa-chevron-right text-xs text-faint" aria-hidden="true"></i>
                    </button>
                  </div>
                ) : null;
              case 'photos':
                return (
                  <div key="photos" className="mt-4">
                    <RecorderPhotos photos={state.photos} previews={engine.previews} disabled={state.status === 'finished'} onFiles={files => engine.addFiles(files)} onRemove={engine.removePhoto} onRetry={engine.retryPhoto} />
                  </div>
                );
              case 'segments':
                return state.segments.length > 0 ? (
                  <ul key="segments" className="mx-4 mt-4 space-y-1 text-sm" data-record-segments={state.segments.length}>
                    {state.segments.map(seg => (
                      <li key={seg.id} className="flex justify-between rounded-lg bg-surface-muted px-3 py-2 text-secondary">
                        <span className="font-medium text-primary">{seg.label ?? seg.kind.charAt(0).toUpperCase() + seg.kind.slice(1)}</span>
                        <span className="tabular-nums">{Math.floor(seg.from_s / 60)}:{String(seg.from_s % 60).padStart(2, '0')} – {Math.floor(seg.to_s / 60)}:{String(seg.to_s % 60).padStart(2, '0')}</span>
                      </li>
                    ))}
                  </ul>
                ) : null;
              case 'lengths':
                // F5: a pool swim counts its lengths; the distance is lengths × the pool (the reducer's own count).
                return state.type === 'swim' && live ? (
                  <LengthsCounter key="lengths" lengths={state.lengths ?? 0} pool={answers?.details.pool} movingS={totals.movingS} unit={unit} disabled={saving} onChange={n => dispatch({ type: 'lengthsSet', lengths: n })} />
                ) : null;
              default:
                return null;
            }
          })}
          {state.status !== 'finished' && (
            <RecorderControls
              status={state.status}
              openSegment={state.openSegmentFromS !== null ? Math.max(0, elapsedS(state, now) - state.openSegmentFromS) : null}
              busy={saving}
              onStart={() => {
                // An armed round timer runs from the first second; the bell is armed inside THIS tap (iOS needs the gesture).
                if (state.timerArmed) armBell();
                dispatch({ type: 'start', now: Date.now() });
              }}
              onPause={() => dispatch({ type: 'pause', now: Date.now() })}
              onResume={() => dispatch({ type: 'resume', now: Date.now() })}
              onMark={onMark}
              onFinish={onFinish}
              mark={layout?.mark !== false}
            />
          )}
        </main>
      )}

      {segmentSheet && state && (
        <SegmentSheet
          seconds={Math.max(0, elapsedS(state, segmentSheet.endedAt) - (state.openSegmentFromS ?? 0))}
          onPick={endSegment}
          onDismiss={() => endSegment('interval', null)}
        />
      )}
      {state && state.status === 'finished' && (
        <FinishSheet
          type={state.type}
          defaultName={state.name ?? defaultActivityName(state.type, new Date(state.startedAt ?? now).getHours())}
          unit={unit}
          photos={state.photos}
          saving={saving}
          error={saveError}
          summary={{
            distanceM: totals?.distanceM ?? 0,
            elapsedS: totals?.elapsedS ?? 0,
            movingS: totals?.movingS ?? 0,
            route: reviewRoute,
            lengths: state.type === 'swim' ? state.lengths ?? 0 : 0,
          }}
          sportOption={sportOption}
          accountVisibility={accountVisibility}
          onSave={save}
          onDiscard={() => setDiscardOpen(true)}
          onDropFailed={dropFailed}
          initial={recordingAnswers(state)}
          timerFormat={state.timer?.spec.format ?? null}
        />
      )}
      {detailsOpen && state && answers && (state.status === 'recording' || state.status === 'paused') && (
        <DetailsSheet type={state.type} value={answers} unit={unit} onChange={a => dispatch({ type: 'setAnswers', answers: a })} onClose={() => setDetailsOpen(false)} />
      )}
      <ConfirmModal
        isOpen={discardOpen}
        title="Discard this recording?"
        message="Nothing was saved. The recording and its photos will be gone from this phone."
        confirmText="Discard"
        onConfirm={() => void discard()}
        onCancel={() => setDiscardOpen(false)}
        overlayZClass="z-[70]"
      />
    </div>
  );
}
