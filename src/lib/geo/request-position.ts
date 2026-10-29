// ── One device position, on a TAP (never on load, never on a keystroke) ─────
// The browser's permission prompt is the user's to answer, so a position is
// asked for only from a control they pressed ("Near me"). Explore's course
// search and the golf composer share this; the recorder and the rangefinder
// keep their own `watchPosition` (a stream, not a fix). iOS 15 floor: plain
// callbacks, no `AbortSignal` on geolocation.

export const POSITION_UNAVAILABLE = 'Location is not available on this device.';
export const POSITION_DENIED = 'Could not get your location — allow it in the browser, or pick a country and region.';

export interface DeviceFix {
  lat: number;
  lng: number;
}

export function requestPosition(): Promise<DeviceFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error(POSITION_UNAVAILABLE));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error(POSITION_DENIED)),
      { maximumAge: 300_000, timeout: 10_000 }
    );
  });
}

/**
 * Whether the device has ALREADY granted location to this site — never asks.
 * The golf round steps (Oct 28 2026, Tom's call) run the one-shot fix on
 * entering the course step only when this is true, so a person who said yes
 * once sees "Playing at X?" without a tap and nobody meets a prompt on
 * arrival. Feature-detected: no Permissions API (iOS 15), a browser that
 * cannot answer for geolocation, or a thrown query all read as "not granted"
 * and the Near me button stands exactly as before.
 */
export async function geolocationGranted(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return false;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms || typeof perms.query !== 'function') return false;
    const status = await perms.query({ name: 'geolocation' });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
