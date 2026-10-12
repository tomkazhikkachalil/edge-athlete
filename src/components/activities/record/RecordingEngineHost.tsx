'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { ActivityType } from '@/lib/activities/catalog';
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
  restoreRecording,
  type RecordingEvent,
  type RecordingState,
} from '@/lib/activities/record/recording';
import { FLUSH_EVERY_POINTS, openRecordingStore, type RecordingMeta, type RecordingStore } from '@/lib/activities/record/storage';
import { useWatchPosition, type GeoFix } from '@/lib/activities/record/geolocation';
import { useWakeLock } from '@/lib/activities/record/wake-lock';
import { liveRouteGrowing } from '@/lib/activities/gps-filter';
import { publishEngine, type RecordingEngineApi } from '@/lib/activities/record/engine-store';

// ── The recording engine — headless, app-wide, lazily loaded ────────────────
// (resume pill program, Oct 12 2026.) Everything the recorder page used to
// own: the state machine's events, the IndexedDB persistence (meta on every
// non-fix event, points every 10 fixes / 15 s, everything on pagehide), the
// GPS watch while recording a GPS type, the wake lock while running, the
// hidden-page gaps, the photo upload queue. Mounted by RecordingProvider
// when a recording exists on this device or the recorder starts one; what it
// knows is published through engine-store.ts. The ROUTE CHANGE that used to
// end all of this is now just a route change.

export default function RecordingEngineHost({ profileId, restore, takePendingStart }: { profileId: string; restore: RecordingMeta | null; takePendingStart: () => ActivityType | null }) {
  const { activeProfile } = useAuth();
  const { showError } = useToast();
  const targetProfileId = activeProfile?.id ?? null;
  const store = useMemo<RecordingStore | null>(() => (typeof window === 'undefined' ? null : openRecordingStore()), []);
  const [state, setState] = useState<RecordingState | null>(null);
  const stateRef = useRef<RecordingState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [gapNotice, setGapNotice] = useState<{ seconds: number } | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  const [lastTouchedAt, setLastTouchedAt] = useState<number | null>(null);
  const filesRef = useRef<Map<string, File>>(new Map());
  const flushedRef = useRef(0);
  const seqRef = useRef(0);
  const restoredRef = useRef<string | null>(null);

  const persistMeta = useCallback(
    (s: RecordingState) => {
      void store?.saveMeta(s, Date.now()).catch(() => undefined);
    },
    [store]
  );
  // EVERY fix reaches the device store (resume pill program, Oct 12 2026): the
  // OPEN batch is rewritten under its key with each fix and closes at
  // FLUSH_EVERY_POINTS — a reload, a killed app or a hard navigation loses at
  // most the write in flight, never the 15 s the old count-or-time rule did.
  const flushPoints = useCallback(
    (s: RecordingState) => {
      const fresh = s.points.slice(flushedRef.current);
      if (fresh.length === 0) return;
      void store?.appendPoints(s.id, seqRef.current, fresh).catch(() => undefined);
      if (fresh.length >= FLUSH_EVERY_POINTS) {
        flushedRef.current = s.points.length;
        seqRef.current += 1;
      }
    },
    [store]
  );

  const dispatch = useCallback(
    (event: RecordingEvent) => {
      setState(prev => {
        if (!prev) return prev;
        const next = reduce(prev, event);
        if (next === prev) return prev;
        if (event.type !== 'fix') persistMeta(next);
        flushPoints(next);
        return next;
      });
      if (event.type !== 'fix') setLastTouchedAt(Date.now());
    },
    [persistMeta, flushPoints]
  );

  // A recording this device did not finish: restore it as it stands — still
  // recording when the time away is short (a gap, shown on the screen), paused
  // where it was last known when it is long (recording.ts restoreRecording).
  useEffect(() => {
    if (!restore || !store || restoredRef.current === restore.id) return;
    restoredRef.current = restore.id;
    let cancelled = false;
    (async () => {
      const loaded = await store.load(restore.id).catch(() => null);
      if (cancelled || !loaded || loaded.profileId !== profileId) return;
      const { state: s, gapS } = restoreRecording(loaded, restore.savedAt, Date.now());
      flushedRef.current = s.points.length;
      seqRef.current = Math.max(1, Math.ceil(s.points.length / 10) + 1);
      for (const p of s.photos) {
        if (p.url) continue;
        const blob = await store.loadPhoto(s.id, p.localId).catch(() => null);
        if (cancelled) return;
        if (blob) {
          const file = new File([blob], `photo-${p.localId}`, { type: blob.type });
          filesRef.current.set(p.localId, file);
          setPreviews(prev => ({ ...prev, [p.localId]: URL.createObjectURL(file) }));
        }
      }
      if (cancelled) return;
      setState(prev => prev ?? s);
      setLastTouchedAt(restore.savedAt);
      if (s !== loaded) persistMeta(s);
      if (gapS > GAP_NOTICE_S) setGapNotice({ seconds: gapS });
    })();
    return () => {
      cancelled = true;
    };
  }, [restore, store, profileId, persistMeta]);

  // A start the recorder asked for before this chunk was loaded.
  useEffect(() => {
    if (restore) return;
    const type = takePendingStart();
    if (!type || stateRef.current) return;
    const fresh = newRecording(newId(), profileId, type);
    flushedRef.current = 0;
    seqRef.current = 0;
    const t = setTimeout(() => {
      setState(prev => prev ?? fresh);
      setLastTouchedAt(Date.now());
      persistMeta(fresh);
    }, 0);
    return () => clearTimeout(t);
  }, [restore, takePendingStart, profileId, persistMeta]);

  // The acting profile changed under a recording that is not theirs: drop
  // the in-memory copy (the device keeps it for its owner).
  useEffect(() => {
    if (stateRef.current && stateRef.current.profileId !== profileId) {
      const t = setTimeout(() => setState(null), 0);
      return () => clearTimeout(t);
    }
  }, [profileId]);

  const running = state?.status === 'recording' || state?.status === 'paused';
  const gpsType = !!state && recordsGps(state.type);
  const geoStatus = useWatchPosition({
    enabled: !!state && state.status === 'recording' && gpsType,
    onFix: (fix: GeoFix) => {
      setLastAccuracy(fix.accuracy);
      dispatch({ type: 'fix', fix: { t: fix.t, lat: fix.lat, lng: fix.lng, ele: fix.ele, accuracy: fix.accuracy } });
    },
    onDenied: () => showError('GPS is off for Edge Athlete', 'Allow location for this site in your phone’s settings, then come back. The timer keeps running.'),
  });
  const wakeHeld = useWakeLock(!!running);

  // The page hidden / shown: a gap, shown honestly on return. pagehide: save
  // everything (the next open restores from here).
  useEffect(() => {
    if (!running) return;
    const onVis = () => {
      const at = Date.now();
      if (document.hidden) dispatch({ type: 'hidden', now: at });
      else {
        dispatch({ type: 'visible', now: at });
        const s = stateRef.current ? reduce(stateRef.current, { type: 'visible', now: at }) : null;
        const gap = s ? lastGapS(s) : 0;
        if (gap > GAP_NOTICE_S) setGapNotice({ seconds: gap });
      }
    };
    const onPageHide = () => {
      const s = stateRef.current;
      if (!s) return;
      persistMeta(s);
      flushPoints(s);
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [running, dispatch, persistMeta, flushPoints]);

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
  const addFiles = useCallback(
    (files: FileList | File[]) => {
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
    },
    [dispatch, showError, store, uploadPhoto]
  );
  const retryPhoto = useCallback(
    (localId: string) => {
      const file = filesRef.current.get(localId);
      if (!file) return;
      dispatch({ type: 'photoUploaded', localId, url: '' }); // clears failed; the upload sets the real url
      dispatch({ type: 'photoFailed', localId });
      uploadPhoto(localId, file);
    },
    [dispatch, uploadPhoto]
  );
  const dropPreviews = useCallback(() => {
    Object.values(previewsRef.current).forEach(u => URL.revokeObjectURL(u));
    setPreviews({});
    filesRef.current.clear();
  }, []);
  const removePhoto = useCallback(
    (localId: string) => {
      const url = previewsRef.current[localId];
      if (url) URL.revokeObjectURL(url);
      setPreviews(prev => {
        const next = { ...prev };
        delete next[localId];
        return next;
      });
      filesRef.current.delete(localId);
      dispatch({ type: 'photoRemoved', localId });
    },
    [dispatch]
  );

  const start = useCallback(
    (type: ActivityType) => {
      const fresh = newRecording(newId(), profileId, type);
      flushedRef.current = 0;
      seqRef.current = 0;
      setState(fresh);
      setGapNotice(null);
      setLastTouchedAt(Date.now());
      persistMeta(fresh);
    },
    [profileId, persistMeta]
  );
  const clear = useCallback(async () => {
    const s = stateRef.current;
    if (s) await store?.clear(s.id).catch(() => undefined);
    dropPreviews();
    setState(null);
    setGapNotice(null);
    setLastAccuracy(null);
  }, [store, dropPreviews]);
  const dismissGapNotice = useCallback(() => setGapNotice(null), []);
  const uploadsSettled = useCallback(() => uploadQueue.current, []);
  const getState = useCallback(() => stateRef.current, []);

  // The FILTERED route (gps-filter.ts) — the one the server stores and the map draws.
  const statePoints = state?.points;
  const stateType = state?.type;
  const drawnRoute = useMemo(() => (statePoints && stateType ? liveRouteGrowing(statePoints, stateType) : []), [statePoints, stateType]);

  // What the rest of the app reads (engine-store.ts): republished whenever any of it changes.
  useEffect(() => {
    const api: RecordingEngineApi = {
      state,
      getState,
      dispatch,
      start,
      clear,
      elapsedS: now => (state ? elapsedS(state, now) : 0),
      totals: (now, heightCm) => (state ? liveTotals(state, now, heightCm) : null),
      drawnRoute,
      geoStatus,
      lastAccuracy,
      wakeHeld,
      gapNotice,
      dismissGapNotice,
      previews,
      addFiles,
      retryPhoto,
      removePhoto,
      uploadsSettled,
      lastTouchedAt,
    };
    publishEngine(api);
  }, [state, getState, dispatch, start, clear, drawnRoute, geoStatus, lastAccuracy, wakeHeld, gapNotice, dismissGapNotice, previews, addFiles, retryPhoto, removePhoto, uploadsSettled, lastTouchedAt]);
  useEffect(() => {
    return () => {
      publishEngine(null);
      Object.values(previewsRef.current).forEach(u => URL.revokeObjectURL(u));
    };
  }, []);

  return null;
}
