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
