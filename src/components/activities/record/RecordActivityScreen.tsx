'use client';

/**
 * /activities/record — the recorder (Live Activities, Oct 4 2026). Tom: a
 * walk, a run, a ride … recorded live from the phone — a timer, GPS, a map,
 * segments marked on the way, photos as tiles — into the Activities pipeline
 * (never a workout). This screen OWNS NO RULE: the state machine is
 * record/recording.ts (pure, tested), the persistence record/storage.ts; it
 * feeds events (a fix, a tap, the page hidden) and renders what the reducer
 * says. The recording lives on the device until Save — a reload resumes it.
 *
 * Facts, plainly: a web page gets GPS only while it is open with the screen
 * on (a wake lock keeps it on where the browser has one; a hidden page opens
 * a gap that is shown on return); steps are an estimate labelled "est.";
 * the server recomputes every number at Save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import { backOr } from '@/lib/nav-back';
import { ACTIVITY_TYPE_DEFS, type ActivityType } from '@/lib/activities/catalog';
import { defaultActivityName } from '@/lib/activities/normalize';
import { readUnitPreference } from '@/lib/activities/format';
import { planCaptureAttach } from '@/lib/media/capture-attach';
import { uploadPostMedia } from '@/lib/media/upload';
import { validateFiles } from '@/lib/media/validation';
import { MAX_UPLOAD_BYTES } from '@/lib/media/upload-rules';
import {
  elapsedS,
  GAP_NOTICE_S,
  lastGapS,
  liveTotals,
  newId,
  newRecording,
  recordsGps,
  reduce,
  toRecordingWire,
  type RecordingEvent,
  type RecordingState,
} from '@/lib/activities/record/recording';
import { flushDue, openRecordingStore, type RecordingMeta, type RecordingStore } from '@/lib/activities/record/storage';
import { useWatchPosition, queryGeoPermission, type GeoFix } from '@/lib/activities/record/geolocation';
import { hasWakeLock, useWakeLock } from '@/lib/activities/record/wake-lock';
import type { SegmentKind } from '@/lib/activities/segments';
import TypePicker from './TypePicker';
import LiveStats from './LiveStats';
import LiveRouteMap from './LiveRouteMap';
import RecorderControls from './RecorderControls';
import SegmentSheet from './SegmentSheet';
import RecorderPhotos from './RecorderPhotos';
import FinishSheet from './FinishSheet';

const localZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export default function RecordActivityScreen() {
  const router = useRouter();
  const { user, profile, initialAuthCheckComplete, activeProfile } = useAuth();
  const { showError, showSuccess } = useToast();
  const targetProfileId = activeProfile?.id ?? null;
  const profileId = targetProfileId ?? user?.id ?? null;
  const heightCm = (() => {
    const h = (activeProfile ?? profile) as { height_cm?: unknown } | null;
    return typeof h?.height_cm === 'number' ? h.height_cm : null;
  })();

  const store = useMemo<RecordingStore | null>(() => (typeof window === 'undefined' ? null : openRecordingStore()), []);
  const [state, setState] = useState<RecordingState | null>(null);
  const stateRef = useRef<RecordingState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [now, setNow] = useState(() => Date.now());
  const [resumeOffer, setResumeOffer] = useState<RecordingMeta | null>(null);
  const [checkedResume, setCheckedResume] = useState(false);
  const [segmentSheet, setSegmentSheet] = useState<{ endedAt: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [geoPermission, setGeoPermission] = useState<PermissionState | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const unit = useMemo(() => readUnitPreference(), []);
  const filesRef = useRef<Map<string, File>>(new Map());
  const flushedRef = useRef(0);
  const seqRef = useRef(0);
  const lastFlushRef = useRef(Date.now());

  useEffect(() => {
    if (initialAuthCheckComplete && !user) router.replace('/');
  }, [initialAuthCheckComplete, user, router]);

  // A recording this device did not finish: offer to resume it (once).
  useEffect(() => {
    if (!profileId || checkedResume) return;
    let cancelled = false;
    (async () => {
      if (store) {
        await store.purgeExpired(Date.now()).catch(() => undefined);
        const found = await store.findUnfinished(profileId, Date.now()).catch(() => null);
        if (!cancelled && found) setResumeOffer(found);
      }
      if (!cancelled) setCheckedResume(true);
    })();
    void queryGeoPermission().then(p => {
      if (!cancelled) setGeoPermission(p);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, store, checkedResume]);

  // The clock: a re-render a second while something is running (the elapsed
  // time is derived from timestamps, never counted — iOS throttles timers).
  const running = state?.status === 'recording' || state?.status === 'paused';
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const persistMeta = useCallback(
    (s: RecordingState) => {
      void store?.saveMeta(s, Date.now()).catch(() => undefined);
    },
    [store]
  );
  const flushPoints = useCallback(
    (s: RecordingState) => {
      const fresh = s.points.slice(flushedRef.current);
      if (fresh.length === 0) return;
      flushedRef.current = s.points.length;
      lastFlushRef.current = Date.now();
      void store?.appendPoints(s.id, seqRef.current++, fresh).catch(() => undefined);
    },
    [store]
  );

  const dispatch = useCallback(
    (event: RecordingEvent) => {
      setState(prev => {
        if (!prev) return prev;
        const next = reduce(prev, event);
        if (next === prev) return prev;
        if (event.type === 'fix') {
          if (flushDue(next.points.length - flushedRef.current, lastFlushRef.current, Date.now())) flushPoints(next);
        } else {
          persistMeta(next);
          flushPoints(next);
        }
        return next;
      });
    },
    [persistMeta, flushPoints]
  );

  // GPS, while recording a GPS type.
  const gpsType = !!state && recordsGps(state.type);
  const geoStatus = useWatchPosition({
    enabled: !!state && state.status === 'recording' && gpsType,
    onFix: (fix: GeoFix) => {
      setLastAccuracy(fix.accuracy);
      dispatch({ type: 'fix', fix: { t: fix.t, lat: fix.lat, lng: fix.lng, ele: fix.ele, accuracy: fix.accuracy } });
    },
    onDenied: () => showError('GPS is off for Edge Athlete', 'Allow location for this site in your phone’s settings, then come back. The timer keeps running.'),
  });
  const wakeHeld = useWakeLock(running);

  // The page hidden / shown: a gap, shown honestly on return.
  useEffect(() => {
    if (!running) return;
    const onVis = () => {
      const at = Date.now();
      if (document.hidden) dispatch({ type: 'hidden', now: at });
      else {
        dispatch({ type: 'visible', now: at });
        const s = stateRef.current ? reduce(stateRef.current, { type: 'visible', now: at }) : null;
        const gap = s ? lastGapS(s) : 0;
        if (gap > GAP_NOTICE_S) showError('GPS paused while the screen was off', `${gap} seconds were not recorded. Keep the screen on while recording.`);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [running, dispatch, showError]);

  // Photos: a tile at once; upload in the background (one at a time).
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const uploadPhoto = useCallback(
    (localId: string, file: File) => {
      uploadQueue.current = uploadQueue.current.then(async () => {
        try {
          const up = await uploadPostMedia(file, targetProfileId ?? undefined);
          dispatch({ type: 'photoUploaded', localId, url: up.url });
        } catch {
          dispatch({ type: 'photoFailed', localId });
        }
      });
    },
    [dispatch, targetProfileId]
  );
  const onFiles = (files: FileList) => {
    const s = stateRef.current;
    if (!s || (s.status !== 'recording' && s.status !== 'paused')) return;
    const { accepted, rejected } = validateFiles(Array.from(files), { maxBytes: MAX_UPLOAD_BYTES, allowVideo: true, maxCount: 20, existingCount: s.photos.length });
    if (rejected.length > 0) showError('Not added', rejected[0].message);
    const plan = planCaptureAttach(accepted);
    for (const file of plan.editor) showError('Add this one after', `${file.name} needs the editor — attach it on the activity page once you finish.`);
    for (const file of plan.attach) {
      const localId = newId();
      filesRef.current.set(localId, file);
      setPreviews(prev => ({ ...prev, [localId]: URL.createObjectURL(file) }));
      dispatch({ type: 'photoAdded', localId, mediaType: file.type.startsWith('video/') ? 'video' : 'image', now: Date.now() });
      void store?.savePhoto(s.id, localId, file).catch(() => undefined);
      uploadPhoto(localId, file);
    }
  };
  const retryPhoto = (localId: string) => {
    const file = filesRef.current.get(localId);
    if (!file) return;
    dispatch({ type: 'photoUploaded', localId, url: '' }); // clears failed; the upload sets the real url
    dispatch({ type: 'photoFailed', localId });
    uploadPhoto(localId, file);
  };
  const removePhoto = (localId: string) => {
    const url = previewsRef.current[localId];
    if (url) URL.revokeObjectURL(url);
    setPreviews(prev => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
    filesRef.current.delete(localId);
    dispatch({ type: 'photoRemoved', localId });
  };
  useEffect(() => {
    return () => {
      Object.values(previewsRef.current).forEach(u => URL.revokeObjectURL(u));
    };
  }, []);

  const pick = (type: ActivityType) => {
    if (!profileId) return;
    const fresh = newRecording(newId(), profileId, type);
    flushedRef.current = 0;
    seqRef.current = 0;
    setState(fresh);
    persistMeta(fresh);
  };
  const resume = async () => {
    if (!store || !resumeOffer) return;
    const loaded = await store.load(resumeOffer.id).catch(() => null);
    setResumeOffer(null);
    if (!loaded) return;
    // The page was gone since the save: that time is a pause, honestly.
    const s: RecordingState =
      loaded.status === 'recording' ? { ...loaded, status: 'paused', pausedAt: resumeOffer.savedAt } : loaded;
    flushedRef.current = s.points.length;
    seqRef.current = Math.max(1, Math.ceil(s.points.length / 10) + 1);
    // Pending photo blobs come back from the store for a retry.
    for (const p of s.photos) {
      if (p.url) continue;
      const blob = await store.loadPhoto(s.id, p.localId).catch(() => null);
      if (blob) {
        const file = new File([blob], `photo-${p.localId}`, { type: blob.type });
        filesRef.current.set(p.localId, file);
        setPreviews(prev => ({ ...prev, [p.localId]: URL.createObjectURL(file) }));
      }
    }
    setState(s);
    if (s.status === 'finished') setFinishing(true);
  };
  const discardOffer = async () => {
    if (store && resumeOffer) await store.clear(resumeOffer.id).catch(() => undefined);
    setResumeOffer(null);
  };

  const onMark = () => {
    const s = stateRef.current;
    if (!s || s.status !== 'recording') return;
    const at = Date.now();
    if (s.openSegmentFromS === null) dispatch({ type: 'markStart', now: at });
    else setSegmentSheet({ endedAt: at });
  };
  const endSegment = (kind: SegmentKind, label: string | null) => {
    const sheet = segmentSheet;
    setSegmentSheet(null);
    if (!sheet) return;
    dispatch({ type: 'markEnd', now: sheet.endedAt, kind, label, id: newId() });
  };

  const onFinish = () => {
    dispatch({ type: 'finish', now: Date.now() });
    setFinishing(true);
  };
  const save = async (name: string, manualDistanceM: number | null) => {
    const s0 = stateRef.current;
    if (!s0 || s0.status !== 'finished') return;
    setSaving(true);
    setSaveError(null);
    let s = reduce(s0, { type: 'setName', name });
    if (manualDistanceM !== null) s = reduce(s, { type: 'setManualDistance', distanceM: manualDistanceM });
    setState(s);
    persistMeta(s);
    try {
      await uploadQueue.current;
      const latest = stateRef.current ?? s;
      const wire = toRecordingWire({ ...latest, name: s.name, manualDistanceM: s.manualDistanceM }, localZone());
      const res = await fetch('/api/activities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity: wire, ...(targetProfileId ? { targetProfileId } : {}) }),
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
      await store?.clear(latest.id).catch(() => undefined);
      showSuccess('Saved', 'Your activity is in Vitals.');
      router.push(`/activities/${json.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the activity.');
      setSaving(false);
    }
  };
  const dropFailed = () => {
    const s = stateRef.current;
    if (!s) return;
    for (const p of s.photos) if (p.failed) removePhoto(p.localId);
  };
  const discard = async () => {
    const s = stateRef.current;
    if (s) await store?.clear(s.id).catch(() => undefined);
    Object.values(previewsRef.current).forEach(u => URL.revokeObjectURL(u));
    setPreviews({});
    filesRef.current.clear();
    setState(null);
    setFinishing(false);
    setDiscardOpen(false);
    setSaving(false);
    setSaveError(null);
  };

  // Leaving mid-recording asks first; the recording survives anyway.
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(
    () => !!stateRef.current && stateRef.current.status !== 'idle',
    () => backOr(router, '/athlete?tab=activities')
  );

  const totals = state ? liveTotals(state, now, heightCm) : null;
  const lastFix = state?.points[state.points.length - 1];
  const stale = !!lastFix && state?.status === 'recording' && now - lastFix.t > 20_000;
  const def = state ? ACTIVITY_TYPE_DEFS[state.type] : null;

  if (!initialAuthCheckComplete || !user) return null;

  return (
    <div className="min-h-screen bg-canvas pb-28" data-record-screen={state?.status ?? 'pick'}>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface/95 px-2 py-2 backdrop-blur pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <button type="button" onClick={requestClose} className="ea-icon-btn inline-flex items-center justify-center text-primary" aria-label="Back">
          <i className="fas fa-arrow-left text-lg" aria-hidden="true"></i>
        </button>
        <h1 className="flex-1 truncate text-base font-bold text-primary">{def ? `Record · ${def.label}` : 'Record an activity'}</h1>
        {running && gpsType && (
          <span className="text-xs text-muted" aria-live="polite">
            {wakeHeld ? 'Screen stays on' : hasWakeLock() ? '' : 'Keep your screen on'}
          </span>
        )}
      </header>

      {resumeOffer && (
        <div className="mx-4 mt-4 rounded-xl border border-brand/40 bg-brand-soft p-4" role="status" data-record-resume-offer="">
          <p className="font-semibold text-primary">Resume your {ACTIVITY_TYPE_DEFS[resumeOffer.type].label.toLowerCase()}?</p>
          <p className="mt-1 text-sm text-secondary">
            Started {new Date(resumeOffer.startedAt ?? resumeOffer.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {resumeOffer.pointCount} fixes saved on this phone.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={resume} className="ea-cta min-h-[44px] flex-1 rounded-lg text-sm font-semibold text-white" data-record-resume-yes="">
              Resume
            </button>
            <button type="button" onClick={discardOffer} className="ea-interactive min-h-[44px] rounded-lg border border-border-strong px-4 text-sm font-medium text-secondary" data-record-resume-discard="">
              Discard
            </button>
          </div>
        </div>
      )}

      {!state && checkedResume && !resumeOffer && (
        <main className="mx-auto max-w-xl px-4 py-4">
          <p className="mb-4 text-sm text-secondary">
            Pick what you are about to do. Edge Athlete records only while this app is open with the screen on; the screen stays awake where your phone allows it. Steps are an estimate.
          </p>
          <TypePicker onPick={pick} />
        </main>
      )}

      {state && def && totals && (
        <main className="mx-auto max-w-xl">
          {state.status === 'idle' && (
            <div className="mx-4 mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-secondary" data-record-ready="">
              {gpsType ? (
                <>
                  <p className="font-semibold text-primary">Ready when you are.</p>
                  <p className="mt-1">
                    GPS records only while the screen is on and this app is in front.{' '}
                    {geoPermission === 'denied' ? 'Location is OFF for Edge Athlete — allow it in your phone’s settings first.' : geoPermission === 'prompt' || geoPermission === null ? 'Your phone will ask to use your location when you start.' : ''}
                  </p>
                </>
              ) : def.recording === 'timer' ? (
                <p>A timer runs; you type the distance when you finish.</p>
              ) : (
                <p>A timer runs for this one.</p>
              )}
              <button type="button" onClick={() => setState(null)} className="mt-2 text-sm font-medium text-brand underline">
                Choose another activity
              </button>
            </div>
          )}
          {gpsType && state.status !== 'idle' && (
            <LiveRouteMap
              points={state.points}
              startedAt={state.startedAt}
              segments={state.segments}
              openSegmentFromS={state.openSegmentFromS}
              photos={state.photos.map(p => ({ localId: p.localId, atS: p.atS }))}
              accuracy={lastAccuracy}
            />
          )}
          <div className="mt-4">
            <LiveStats type={state.type} totals={totals} unit={unit} gps={gpsType ? { status: geoStatus, accuracy: lastAccuracy, stale } : null} />
          </div>
          {state.status !== 'idle' && (
            <div className="mt-4">
              <RecorderPhotos photos={state.photos} previews={previews} disabled={state.status === 'finished'} onFiles={onFiles} onRemove={removePhoto} onRetry={retryPhoto} />
            </div>
          )}
          {state.segments.length > 0 && (
            <ul className="mx-4 mt-4 space-y-1 text-sm" data-record-segments={state.segments.length}>
              {state.segments.map(seg => (
                <li key={seg.id} className="flex justify-between rounded-lg bg-surface-muted px-3 py-2 text-secondary">
                  <span className="font-medium text-primary">{seg.label ?? seg.kind.charAt(0).toUpperCase() + seg.kind.slice(1)}</span>
                  <span className="tabular-nums">{Math.floor(seg.from_s / 60)}:{String(seg.from_s % 60).padStart(2, '0')} – {Math.floor(seg.to_s / 60)}:{String(seg.to_s % 60).padStart(2, '0')}</span>
                </li>
              ))}
            </ul>
          )}
          {state.status !== 'finished' && (
            <RecorderControls
              status={state.status}
              openSegment={state.openSegmentFromS !== null ? Math.max(0, elapsedS(state, now) - state.openSegmentFromS) : null}
              busy={saving}
              onStart={() => dispatch({ type: 'start', now: Date.now() })}
              onPause={() => dispatch({ type: 'pause', now: Date.now() })}
              onResume={() => dispatch({ type: 'resume', now: Date.now() })}
              onMark={onMark}
              onFinish={onFinish}
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
      {finishing && state && state.status === 'finished' && (
        <FinishSheet
          type={state.type}
          defaultName={state.name ?? defaultActivityName(state.type, new Date(state.startedAt ?? Date.now()).getHours())}
          unit={unit}
          photos={state.photos}
          saving={saving}
          error={saveError}
          onSave={save}
          onDiscard={() => setDiscardOpen(true)}
          onDropFailed={dropFailed}
        />
      )}
      <ConfirmModal
        isOpen={discardOpen}
        title="Discard this recording?"
        message="Nothing was saved. The recording and its photos will be gone from this phone."
        confirmText="Discard"
        onConfirm={discard}
        onCancel={() => setDiscardOpen(false)}
        overlayZClass="z-[70]"
      />
      <ConfirmModal
        isOpen={confirmOpen}
        title="Leave the recording?"
        message="It keeps recording nothing while you are away, but what you have so far stays on this phone — you can resume it from here."
        confirmText="Leave"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        overlayZClass="z-[70]"
      />
    </div>
  );
}
