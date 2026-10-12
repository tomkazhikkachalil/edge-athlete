'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth';
import type { ActivityType } from '@/lib/activities/catalog';
import { openRecordingStore, type RecordingMeta } from '@/lib/activities/record/storage';
import { getEngine, getEngineServer, subscribeEngine, type RecordingEngineApi } from '@/lib/activities/record/engine-store';

// ── The recording lives under the app's root (resume pill program, Oct 12 2026)
// Tom: leaving the session screen never pauses or ends anything. A web page
// gets GPS only in the foreground, but the APP is in the foreground while
// you read the feed — so the engine (the state machine, the GPS watch, the
// wake lock, the IndexedDB flushes, the photo uploads) lives HERE, for the
// whole app, and the recorder page is a view over it. Until this, the page
// owned it: an in-app navigation stopped GPS, lost up to 15 s of points and,
// on return, the clock rolled back to the last save.
//
// Bundle discipline: this provider imports the store (small) and the types;
// the engine itself (recording.ts, gps-filter.ts, normalize …) is a
// next/dynamic chunk mounted ONLY when a recording exists — found on the
// device at boot — or the recorder starts one. Every page pays for a
// context, not for the recorder.

const RecordingEngineHost = dynamic(() => import('./RecordingEngineHost'), { ssr: false });

export interface RecordingContextValue {
  /** The device answered whether a recording waits (the reopen prompt and the pill wait on it). */
  ready: boolean;
  /** The engine, once a recording exists on this device (restored or started). */
  engine: RecordingEngineApi | null;
  /** Start a recording of this type (loads the engine first when needed). */
  start(type: ActivityType): void;
  /** The acting profile — the recording's owner (a guardian records for the athlete they act for). */
  profileId: string | null;
}

const RecordingContext = createContext<RecordingContextValue>({ ready: false, engine: null, start: () => undefined, profileId: null });

export function useRecording(): RecordingContextValue {
  return useContext(RecordingContext);
}

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const { user, activeProfile, initialAuthCheckComplete } = useAuth();
  const profileId = activeProfile?.id ?? user?.id ?? null;
  const engine = useSyncExternalStore(subscribeEngine, getEngine, getEngineServer);
  const [wanted, setWanted] = useState(false);
  const [ready, setReady] = useState(false);
  const [restore, setRestore] = useState<RecordingMeta | null>(null);
  const pendingStartRef = useRef<ActivityType | null>(null);

  // Boot: does a recording wait on this device for this profile? Purge what
  // has expired (the 7-day retention), then look. Signed out: nothing waits.
  useEffect(() => {
    if (!initialAuthCheckComplete) return;
    let cancelled = false;
    (async () => {
      const store = profileId ? openRecordingStore() : null;
      let found: RecordingMeta | null = null;
      if (store && profileId) {
        await store.purgeExpired(Date.now()).catch(() => undefined);
        found = await store.findUnfinished(profileId, Date.now()).catch(() => null);
      } else {
        await Promise.resolve();
      }
      if (cancelled) return;
      setRestore(found);
      if (found) setWanted(true);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialAuthCheckComplete, profileId]);

  const start = useCallback(
    (type: ActivityType) => {
      const live = getEngine();
      if (live) {
        live.start(type);
        return;
      }
      pendingStartRef.current = type;
      setWanted(true);
    },
    []
  );
  const takePendingStart = useCallback((): ActivityType | null => {
    const t = pendingStartRef.current;
    pendingStartRef.current = null;
    return t;
  }, []);

  const value = useMemo<RecordingContextValue>(() => ({ ready, engine, start, profileId }), [ready, engine, start, profileId]);

  return (
    <RecordingContext.Provider value={value}>
      {wanted && profileId && <RecordingEngineHost profileId={profileId} restore={restore} takePendingStart={takePendingStart} />}
      {children}
    </RecordingContext.Provider>
  );
}
