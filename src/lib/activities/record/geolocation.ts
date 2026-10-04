'use client';

// ── The recorder's GPS watch (Live Activities) ──────────────────────────────
// `watchPosition` with the golf rangefinder's policy, lifted into a hook
// (CourseMapInner.tsx stays as it is this round): high accuracy, a 5 s
// cache, a 15 s timeout; only PERMISSION_DENIED stops the watch — TIMEOUT and
// POSITION_UNAVAILABLE are the phone thinking (a tunnel, a standstill) and
// the watch keeps going. The browser only delivers fixes while the page is in
// the foreground with the screen on; the screen's wake lock and its
// visibilitychange gap are how that fact is lived with.

import { useEffect, useRef, useState } from 'react';

export interface GeoFix {
  t: number;
  lat: number;
  lng: number;
  ele: number | null;
  accuracy: number | null;
}

export type GeoStatus = 'idle' | 'watching' | 'denied' | 'unsupported';

export function hasGeolocation(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation && typeof navigator.geolocation.watchPosition === 'function';
}

/** The permission as the browser reports it, when it says; null when it does not. */
export async function queryGeoPermission(): Promise<PermissionState | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

export function useWatchPosition(opts: { enabled: boolean; onFix: (fix: GeoFix) => void; onDenied?: () => void }): GeoStatus {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const onFixRef = useRef(opts.onFix);
  const onDeniedRef = useRef(opts.onDenied);
  useEffect(() => {
    onFixRef.current = opts.onFix;
    onDeniedRef.current = opts.onDenied;
  });

  useEffect(() => {
    if (!opts.enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the watch's status is the effect's own state
      setStatus(s => (s === 'denied' ? s : 'idle'));
      return;
    }
    if (!hasGeolocation()) {
      setStatus('unsupported');
      return;
    }
    setStatus('watching');
    const id = navigator.geolocation.watchPosition(
      pos => {
        const c = pos.coords;
        onFixRef.current({
          t: pos.timestamp || Date.now(),
          lat: c.latitude,
          lng: c.longitude,
          ele: typeof c.altitude === 'number' && Number.isFinite(c.altitude) ? c.altitude : null,
          accuracy: typeof c.accuracy === 'number' && Number.isFinite(c.accuracy) ? c.accuracy : null,
        });
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          onDeniedRef.current?.();
        }
        // TIMEOUT / POSITION_UNAVAILABLE: temporary — the watch continues.
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [opts.enabled]);

  return status;
}
