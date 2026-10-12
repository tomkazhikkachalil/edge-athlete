// ── The live recording engine, published app-wide (resume pill, Oct 2026) ──
// The engine (RecordingEngineHost) is a lazily loaded headless component
// under the app's root; what it knows is published here so the recorder
// screen, the resume pill, the reopen prompt and the Drafts page read ONE
// object through useSyncExternalStore — no prop callbacks, no parent
// re-renders, and the root chunk never imports the engine itself (only this
// store and the types). Zero runtime imports.

import type { ActivityType } from '../catalog';
import type { ActivityPoint } from '../types';
import type { LiveTotals, RecordingEvent, RecordingState } from './recording';
import type { GeoStatus } from './geolocation';

export interface RecordingEngineApi {
  /** The recording as it stands; null when none is in progress on this device. */
  state: RecordingState | null;
  /** The latest state, read outside React's render (a save path after awaits). */
  getState(): RecordingState | null;
  dispatch(event: RecordingEvent): void;
  /** A fresh recording of this type, persisted at once (idle until Start). */
  start(type: ActivityType): void;
  /** Forget the recording: the device's copy, the pending photo bytes, the state. */
  clear(): Promise<void>;
  elapsedS(now: number): number;
  totals(now: number, heightCm: number | null): LiveTotals | null;
  /** The FILTERED route (gps-filter.ts) — the one the server stores and the map draws. */
  drawnRoute: ActivityPoint[];
  geoStatus: GeoStatus;
  lastAccuracy: number | null;
  wakeHeld: boolean;
  /** A gap the app could not record (the phone locked, the app closed), to be shown on the screen until dismissed. */
  gapNotice: { seconds: number } | null;
  dismissGapNotice(): void;
  /** Object URLs for the photo tiles, by localId. */
  previews: Record<string, string>;
  addFiles(files: FileList | File[]): void;
  retryPhoto(localId: string): void;
  removePhoto(localId: string): void;
  /** Resolves when every queued photo upload has settled (Save waits on it). */
  uploadsSettled(): Promise<void>;
  /** Epoch ms of the last thing that happened to it (a tap, a save) — the Drafts order. */
  lastTouchedAt: number | null;
}

let current: RecordingEngineApi | null = null;
const listeners = new Set<() => void>();

export function publishEngine(api: RecordingEngineApi | null): void {
  current = api;
  for (const fn of listeners) fn();
}

export function getEngine(): RecordingEngineApi | null {
  return current;
}

export function getEngineServer(): null {
  return null;
}

export function subscribeEngine(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
