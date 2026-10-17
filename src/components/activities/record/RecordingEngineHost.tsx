'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { ActivityType } from '@/lib/activities/catalog';
import { planCaptureAttach } from '@/lib/media/capture-attach';
import { uploadPostMedia } from '@/lib/media/upload';
import { createUploadQueue, type QueueState, type UploadQueue } from '@/lib/media/upload-queue';
import { openMediaStash } from '@/lib/workouts/media-stash';
import { getOnline, subscribeOnline } from '@/lib/net/online';
import { grabPosterInto } from '@/components/media/grab-poster';
import { validateFiles } from '@/lib/media/validation';
import { MAX_UPLOAD_BYTES } from '@/lib/media/upload-rules';
import {
  elapsedS,
  GAP_NOTICE_S,
  lastGapS,
  liveTotals,
  newId,
  newRecording,
  recordsGpsFor,
  reduce,
  restoreRecording,
  type RecordingEvent,
  type RecordingState,
} from '@/lib/activities/record/recording';
import { FLUSH_EVERY_POINTS, openRecordingStore, type RecordingMeta, type RecordingStore } from '@/lib/activities/record/storage';
import { useWatchPosition, type GeoFix } from '@/lib/activities/record/geolocation';
import { useWakeLock } from '@/lib/device/wake-lock';
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
  const [lastTouchedAt, setLastTouchedAt] = useState<number | null>(null);
  const targetProfileIdRef = useRef(targetProfileId);
  useEffect(() => { targetProfileIdRef.current = targetProfileId; }, [targetProfileId]);
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

  // Photos: a tile at once; the upload in the background through THE upload
  // queue (video posters PR 3, Oct 13 2026) — one per recording, its stash
  // keyed by the recording's id (an ArrayBuffer store: the recording's own
  // photo store held Blobs, the shape WebKit refused on Sep 3 2026). The
  // queue tells the reducer what landed (the URL, then the clip's poster),
  // what failed, and keeps the previews; a reconnect retries by itself.
  const queueRef = useRef<{ id: string; queue: UploadQueue } | null>(null);
  const ensureQueue = useCallback((recordingId: string): UploadQueue => {
    if (queueRef.current?.id === recordingId) return queueRef.current.queue;
    queueRef.current?.queue.destroy();
    let stash = null;
    try { stash = openMediaStash(); } catch { stash = null; }
    const postersTold = new Set<string>();
    const failedTold = new Set<string>();
    const queue = createUploadQueue({
      sessionId: `recording:${recordingId}`,
      stash,
      upload: uploadPostMedia,
      targetProfileId: () => targetProfileIdRef.current ?? undefined,
      isOnline: getOnline,
      subscribeOnline,
      onStored: item => {
        if (item.storedUrl) dispatch({ type: 'photoUploaded', localId: item.localId, url: item.storedUrl, thumbnailUrl: item.posterUrl ?? null });
      },
      onChange: (items: QueueState) => {
        const next: Record<string, string> = {};
        for (const item of Object.values(items)) {
          const preview = queue.previewFor(item.localId);
          if (preview) next[item.localId] = preview;
          if (item.status === 'failed' && !failedTold.has(`${item.localId}:${item.generation}`)) {
            failedTold.add(`${item.localId}:${item.generation}`);
            dispatch({ type: 'photoFailed', localId: item.localId });
          }
          if (item.storedUrl && item.posterUrl && !postersTold.has(item.localId)) {
            postersTold.add(item.localId);
            dispatch({ type: 'photoUploaded', localId: item.localId, url: item.storedUrl, thumbnailUrl: item.posterUrl });
          }
        }
        setPreviews(next);
      },
    });
    queueRef.current = { id: recordingId, queue };
    return queue;
  }, [dispatch]);
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
      // The photos still uploading: their bytes are in the queue's stash (PR 3)
      // — or, for a recording from before it, in the recording's own photo
      // store — and upload again by themselves. Bytes gone = a failed tile.
      const q = ensureQueue(s.id);
      const { restored } = await q.resumeFromStash();
      if (cancelled) return;
      const adopted = new Set(restored.map(r => r.item.localId));
      for (const p of s.photos) {
        if (p.url || adopted.has(p.localId)) continue;
        const blob = await store.loadPhoto(s.id, p.localId).catch(() => null);
        if (cancelled) return;
        if (blob) q.adopt(p.localId, new File([blob], `photo-${p.localId}`, { type: blob.type }));
        else s.photos = s.photos.map(x => (x.localId === p.localId ? { ...x, failed: true } : x));
      }
      for (const { item, file } of restored) grabPosterInto(q, item.localId, file);
      if (cancelled) return;
      setState(prev => prev ?? s);
      setLastTouchedAt(restore.savedAt);
      if (s !== loaded) persistMeta(s);
      if (gapS > GAP_NOTICE_S) setGapNotice({ seconds: gapS });
    })();
    return () => {
      cancelled = true;
    };
  }, [restore, store, profileId, persistMeta, ensureQueue]);

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
  const gpsType = !!state && recordsGpsFor(state);
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

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const s = stateRef.current;
      if (!s || (s.status !== 'recording' && s.status !== 'paused')) return;
      const { accepted, rejected } = validateFiles(Array.from(files), { maxBytes: MAX_UPLOAD_BYTES, allowVideo: true, maxCount: 20, existingCount: s.photos.length });
      if (rejected.length > 0) showError('Not added', rejected[0].message);
      const plan = planCaptureAttach(accepted);
      for (const file of plan.editor) showError('Add this one after', `${file.name} needs the editor — attach it on the activity page once you finish.`);
      if (plan.attach.length === 0) return;
      const q = ensureQueue(s.id);
      const items = q.register(plan.attach);
      items.forEach((item, i) => {
        dispatch({ type: 'photoAdded', localId: item.localId, mediaType: item.kind, now: Date.now() });
        grabPosterInto(q, item.localId, plan.attach[i]);
      });
    },
    [dispatch, showError, ensureQueue]
  );
  const retryPhoto = useCallback(
    (localId: string) => {
      const q = queueRef.current?.queue;
      if (!q) return;
      dispatch({ type: 'photoRetried', localId });
      q.retry(localId);
    },
    [dispatch]
  );
  const dropPreviews = useCallback(() => {
    queueRef.current?.queue.destroy();
    queueRef.current = null;
    setPreviews({});
  }, []);
  const removePhoto = useCallback(
    (localId: string) => {
      queueRef.current?.queue.forget(localId);
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
    queueRef.current?.queue.clearStash();
    dropPreviews();
    setState(null);
    setGapNotice(null);
    setLastAccuracy(null);
  }, [store, dropPreviews]);
  const dismissGapNotice = useCallback(() => setGapNotice(null), []);
  const uploadsSettled = useCallback(async () => { await queueRef.current?.queue.settle(); }, []);
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
      queueRef.current?.queue.destroy();
      queueRef.current = null;
    };
  }, []);

  return null;
}
