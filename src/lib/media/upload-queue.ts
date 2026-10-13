// ── THE upload queue (video posters program, PR 2 — Oct 13 2026) ────────────
// Tom: "Media should never appear broken at any stage. Show the local file
// immediately … show upload progress on the media … if an upload fails, show
// the preview with a clear 'Upload failed, tap to retry' state. Keep the local
// file so the user does not have to re-capture."
//
// The workout clips' queue (Oct 8, useSetMediaUploads) generalised so the
// composer, Edit post, the activity page and the workouts share ONE rule:
//   • a pure reducer over QueueItems — the state machine, node-testable;
//   • a runtime with TWO chains: `uploadChain` (the network — strictly one at
//     a time, never Promise.all: N concurrent phone uploads were the Sep 3
//     2026 reload) and `deviceChain` (the CPU — a photo resize, a poster grab,
//     a blur grab — sequential and SEPARATE, so a 40 MB PUT never waits on a
//     decode and two decodes never overlap);
//   • a generation counter per item — an edit or a forget bumps it, so an
//     upload of the OLD bytes that lands later is ignored;
//   • the bytes in the IndexedDB stash (ArrayBuffer, never a Blob) so a page
//     iOS threw away comes back with its tiles;
//   • the online rule: an attempt while offline fails AT ONCE as `offline`
//     (no 60 s XHR hang); when the connection returns, failures of kind
//     network | offline are re-queued by themselves — a `refused` 4xx or
//     `too-large` stays tap-to-retry (they would loop forever).
// `register` returns synchronously: the tile is on screen before the stash
// write and the first upload start (convention 8 — nothing heavy between the
// camera's hand-back and the tile).

import type { MediaStash, StashPlace } from '@/lib/workouts/media-stash';
import { failureKindOf, type UploadedMedia, type UploadOptions } from './upload';

export type UploadStatus = 'pending' | 'failed' | 'stored' | 'processing';
export type FailureKind = 'network' | 'offline' | 'refused' | 'too-large';

export interface QueueItem {
  localId: string;
  kind: 'image' | 'video';
  /** pending = queued or in flight (`progress` says which); stored = the server answered a URL; processing = stored, the server still converting; failed = tap to retry. */
  status: UploadStatus;
  /** Bumped by an edit, a retry or a forget: an event under an older generation is a no-op. */
  generation: number;
  /** 0..1 of the main bytes. */
  progress: number;
  storedUrl?: string;
  /** The uploaded poster.jpg (a video). */
  posterUrl?: string;
  /** The uploaded untouched original (an edited photo, inline). */
  sourceUrl?: string;
  blurHash?: string;
  /** Device poster grabs so far (the poster plan's counter). */
  posterAttempts: number;
  /** What the prepare step did to the bytes (the composer's post-time resize). */
  prepared?: { width?: number; height?: number; resized: boolean };
  processing?: boolean;
  failure?: { kind: FailureKind; message: string };
}

export type QueueState = Record<string, QueueItem>;

export type QueueEvent =
  | { type: 'register'; localId: string; kind: 'image' | 'video' }
  | { type: 'start'; localId: string; generation: number }
  | { type: 'progress'; localId: string; generation: number; fraction: number }
  | { type: 'prepared'; localId: string; generation: number; width?: number; height?: number; resized: boolean }
  | { type: 'stored'; localId: string; generation: number; url: string; processing?: boolean }
  | { type: 'poster'; localId: string; generation: number; url: string }
  | { type: 'poster-attempt'; localId: string }
  | { type: 'source'; localId: string; generation: number; url: string }
  | { type: 'blur'; localId: string; hash: string }
  | { type: 'failed'; localId: string; generation: number; failure: { kind: FailureKind; message: string } }
  | { type: 'retry'; localId: string }
  | { type: 'replace'; localId: string }
  | { type: 'forget'; localId: string };

const RETRY_ON_RECONNECT: ReadonlySet<FailureKind> = new Set(['network', 'offline']);

/** The state machine — pure. Returns the same object when nothing changed. */
export function reduceQueue(state: QueueState, event: QueueEvent): QueueState {
  const item = state[event.localId];
  switch (event.type) {
    case 'register':
      if (item) return state;
      return { ...state, [event.localId]: { localId: event.localId, kind: event.kind, status: 'pending', generation: 1, progress: 0, posterAttempts: 0 } };
    case 'forget': {
      if (!item) return state;
      const { [event.localId]: _gone, ...rest } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    }
    case 'retry':
      if (!item || item.status !== 'failed') return state;
      return { ...state, [event.localId]: { ...item, status: 'pending', generation: item.generation + 1, progress: 0, failure: undefined } };
    case 'replace':
      if (!item) return state;
      return {
        ...state,
        [event.localId]: { ...item, status: 'pending', generation: item.generation + 1, progress: 0, storedUrl: undefined, posterUrl: undefined, sourceUrl: undefined, blurHash: undefined, prepared: undefined, processing: undefined, failure: undefined },
      };
    case 'poster-attempt':
      if (!item) return state;
      return { ...state, [event.localId]: { ...item, posterAttempts: item.posterAttempts + 1 } };
    case 'blur':
      if (!item || item.blurHash === event.hash) return state;
      return { ...state, [event.localId]: { ...item, blurHash: event.hash } };
    default:
      break;
  }
  // Every event below carries a generation: a stale one is a no-op.
  if (!item || item.generation !== event.generation) return state;
  switch (event.type) {
    case 'start':
      return { ...state, [event.localId]: { ...item, status: 'pending', progress: 0, failure: undefined } };
    case 'progress': {
      const fraction = Math.min(1, Math.max(0, event.fraction));
      if (fraction === item.progress) return state;
      return { ...state, [event.localId]: { ...item, progress: fraction } };
    }
    case 'prepared':
      return { ...state, [event.localId]: { ...item, prepared: { width: event.width, height: event.height, resized: event.resized } } };
    case 'stored':
      return { ...state, [event.localId]: { ...item, status: event.processing ? 'processing' : 'stored', progress: 1, storedUrl: event.url, processing: event.processing === true, failure: undefined } };
    case 'poster':
      return { ...state, [event.localId]: { ...item, posterUrl: event.url } };
    case 'source':
      return { ...state, [event.localId]: { ...item, sourceUrl: event.url } };
    case 'failed':
      return { ...state, [event.localId]: { ...item, status: 'failed', failure: event.failure } };
    default:
      return state;
  }
}

/** The failures the connection's return re-queues by itself. */
export function failedForRetryOnline(items: readonly QueueItem[]): string[] {
  return items.filter(i => i.status === 'failed' && i.failure && RETRY_ON_RECONNECT.has(i.failure.kind)).map(i => i.localId);
}

export function settleSummary(items: readonly QueueItem[]): { failed: number; pending: number; processing: number } {
  let failed = 0;
  let pending = 0;
  let processing = 0;
  for (const i of items) {
    if (i.status === 'failed') failed += 1;
    else if (i.status === 'pending') pending += 1;
    else if (i.status === 'processing') processing += 1;
  }
  return { failed, pending, processing };
}

/** A stored or processing item has landed; a failed one has stopped. */
export function isSettled(item: QueueItem | undefined): boolean {
  return !!item && item.status !== 'pending';
}

// Per-session uniqueness is all a localId needs. Not `crypto.randomUUID`:
// Safari 15.4+, below the iOS 15 floor.
export const newLocalId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type Uploader = (file: File, targetProfileId?: string, options?: UploadOptions) => Promise<UploadedMedia>;

export interface PrepareResult {
  /** The bytes to upload (a resized render, or the file itself). */
  file: File;
  /** The untouched original when the render differs — kept on the device for the caller (deferred or inline). */
  original?: File;
  width?: number;
  height?: number;
}

export interface UploadQueueOptions {
  /** The stash session ('composer', the workout id, `edit-post:<id>` …). */
  sessionId: string;
  /** `openMediaStash()` or null — fail-open: no stash, no reload recovery, nothing else lost. */
  stash?: MediaStash | null;
  upload: Uploader;
  /** Guardian acting-as — read at upload time. */
  targetProfileId?: () => string | undefined;
  /** Runs on the DEVICE chain before the first upload of a file (the composer's post-time photo resize). null = upload as-is. */
  prepare?: (file: File, localId: string) => Promise<PrepareResult | null>;
  /** Keep a file's bytes in the stash after its upload landed — until `clearStash` / `forget`. The composer: a
   *  reload before Post rebuilds its tiles from the bytes (the stored URL lives only in memory); a workout
   *  set writes the URL into its own data and lets the bytes go. Default false. */
  keepStashedAfterUpload?: boolean;
  onChange: (state: QueueState) => void;
  /** The main bytes landed — the host writes the URL into ITS data. */
  onStored?: (item: QueueItem) => void;
  notify?: (title: string, message: string) => void;
  /** Injected for tests; default the browser's. */
  isOnline?: () => boolean;
  subscribeOnline?: (listener: () => void) => () => void;
}

export interface UploadQueue {
  /** The tiles first: returns at once; the stash write and the upload start on a microtask. */
  register(files: File[], place?: StashPlace): QueueItem[];
  /** A known file under a KNOWN id (the stash's resume, an editor result replacing an asset the queue never saw). */
  adopt(localId: string, file: File, place?: StashPlace): QueueItem;
  retry(localId: string): void;
  forget(localId: string): void;
  forgetAll(): void;
  /** Edited bytes replace the queued ones under the same id; a landing upload of the old bytes is ignored. */
  replaceWithEdited(localId: string, file: File, extras?: { previewUrl?: string; posterBlob?: Blob | null }): void;
  /** The video's poster.jpg — uploaded after the main bytes; replaces an earlier poster (generation-safe). */
  attachPoster(localId: string, blob: Blob): void;
  /** An edited photo's untouched original, uploaded inline (the recipe and the source land together). */
  attachOriginal(localId: string, file: File): void;
  attachBlur(localId: string, hash: string): void;
  /** Run CPU work on the device chain (a grab, a resize) — one at a time, never beside an upload's own prepare. */
  device<T>(task: () => Promise<T>): Promise<T>;
  fileFor(localId: string): File | null;
  /** The untouched original the prepare step kept (the composer defers it after the post exists). */
  originalFor(localId: string): File | null;
  previewFor(localId: string): string | undefined;
  itemFor(localId: string): QueueItem | undefined;
  /** Synchronous — `settle()` callers read this, never React state. */
  snapshot(): QueueState;
  /** Resolves at stored / processing / failed of the CURRENT generation. */
  waitFor(localId: string): Promise<QueueItem>;
  /** After both chains drain (including work enqueued while waiting). */
  settle(): Promise<{ failed: number; pending: number; processing: number }>;
  /** The stash's files of this session the queue does not hold yet — adopted under their ids. */
  resumeFromStash(): Promise<{ restored: Array<{ item: QueueItem; file: File; place: StashPlace | null }>; lost: number }>;
  clearStash(): void;
  /** Unsubscribes, revokes every preview. */
  destroy(): void;
}

export function createUploadQueue(opts: UploadQueueOptions): UploadQueue {
  const isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const files = new Map<string, File>();
  const originals = new Map<string, File>();
  const previews = new Map<string, string>();
  const waiters = new Map<string, Array<(item: QueueItem) => void>>();
  let state: QueueState = {};
  let uploadChain: Promise<void> = Promise.resolve();
  let deviceChain: Promise<void> = Promise.resolve();
  let destroyed = false;

  const dispatch = (event: QueueEvent) => {
    const next = reduceQueue(state, event);
    if (next === state) return;
    state = next;
    opts.onChange(state);
    const item = state[event.localId];
    if (item && isSettled(item)) {
      const pending = waiters.get(event.localId);
      if (pending) {
        waiters.delete(event.localId);
        for (const resolve of pending) resolve(item);
      }
    }
  };
  const generationOf = (localId: string) => state[localId]?.generation ?? -1;
  const current = (localId: string, generation: number) => !destroyed && generationOf(localId) === generation;
  const stash = () => opts.stash ?? null;
  const target = () => opts.targetProfileId?.();

  const onUpload = (task: () => Promise<void>) => {
    uploadChain = uploadChain.then(task).catch(() => undefined);
    return uploadChain;
  };
  const onDevice = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = deviceChain.then(task);
    deviceChain = run.then(() => undefined, () => undefined);
    return run;
  };

  const enqueueUpload = (localId: string) => {
    const generation = generationOf(localId);
    void onUpload(async () => {
      if (!current(localId, generation)) return; // superseded
      const file = files.get(localId);
      if (!file) return;
      if (!isOnline()) {
        dispatch({ type: 'failed', localId, generation, failure: { kind: 'offline', message: 'You are offline — it will upload when you are back online' } });
        return;
      }
      dispatch({ type: 'start', localId, generation });
      try {
        let body = file;
        if (opts.prepare && !state[localId]?.prepared) {
          const prepared = await onDevice(() => opts.prepare!(file, localId));
          if (!current(localId, generation)) return;
          if (prepared) {
            body = prepared.file;
            files.set(localId, prepared.file);
            if (prepared.original) originals.set(localId, prepared.original);
            dispatch({ type: 'prepared', localId, generation, width: prepared.width, height: prepared.height, resized: !!prepared.original });
          } else {
            dispatch({ type: 'prepared', localId, generation, resized: false });
          }
        }
        const uploaded = await opts.upload(body, target(), {
          onProgress: fraction => { if (current(localId, generation)) dispatch({ type: 'progress', localId, generation, fraction }); },
        });
        if (!current(localId, generation)) return;
        dispatch({ type: 'stored', localId, generation, url: uploaded.url, processing: uploaded.processing === true });
        const item = state[localId];
        if (item) opts.onStored?.(item);
        if (!opts.keepStashedAfterUpload) void stash()?.remove(opts.sessionId, localId).catch(() => undefined);
      } catch (err) {
        if (!current(localId, generation)) return;
        const kind = failureKindOf(err);
        const message = err instanceof Error && err.message ? err.message : 'The file is still here — tap Retry.';
        dispatch({ type: 'failed', localId, generation, failure: { kind, message } });
        opts.notify?.('Upload failed', message);
      }
    });
  };

  const track = (localId: string, file: File, place?: StashPlace): QueueItem => {
    files.set(localId, file);
    previews.set(localId, URL.createObjectURL(file));
    dispatch({ type: 'register', localId, kind: file.type.startsWith('video/') ? 'video' : 'image' });
    // After the tile (convention 8): the stash write and the upload start on a microtask.
    queueMicrotask(() => {
      if (destroyed || !state[localId]) return;
      void stash()?.save(opts.sessionId, localId, file, Date.now(), place).catch(() => undefined);
      enqueueUpload(localId);
    });
    return state[localId];
  };

  const unsubscribeOnline = (opts.subscribeOnline ?? (() => () => undefined))(() => {
    if (destroyed || !isOnline()) return;
    for (const localId of failedForRetryOnline(Object.values(state))) queue.retry(localId);
  });

  const queue: UploadQueue = {
    register(list, place) {
      return list.map(file => track(newLocalId(), file, place));
    },
    adopt(localId, file, place) {
      if (state[localId]) return state[localId];
      return track(localId, file, place);
    },
    retry(localId) {
      const item = state[localId];
      if (!item || item.status !== 'failed' || !files.has(localId)) return;
      dispatch({ type: 'retry', localId });
      enqueueUpload(localId);
    },
    forget(localId) {
      const preview = previews.get(localId);
      if (preview) URL.revokeObjectURL(preview);
      previews.delete(localId);
      files.delete(localId);
      originals.delete(localId);
      dispatch({ type: 'forget', localId }); // the generation is gone with it: a landing upload finds no item
      void stash()?.remove(opts.sessionId, localId).catch(() => undefined);
    },
    forgetAll() {
      for (const localId of Object.keys(state)) queue.forget(localId);
    },
    replaceWithEdited(localId, file, extras = {}) {
      if (!state[localId]) return;
      const old = previews.get(localId);
      const preview = extras.previewUrl ?? URL.createObjectURL(file);
      if (old && old !== preview) URL.revokeObjectURL(old);
      previews.set(localId, preview);
      files.set(localId, file);
      originals.delete(localId);
      dispatch({ type: 'replace', localId });
      void stash()?.save(opts.sessionId, localId, file, Date.now()).catch(() => undefined);
      enqueueUpload(localId);
      if (extras.posterBlob) queue.attachPoster(localId, extras.posterBlob);
    },
    attachPoster(localId, blob) {
      const generation = generationOf(localId);
      if (generation < 0) return;
      dispatch({ type: 'poster-attempt', localId });
      void onUpload(async () => {
        if (!current(localId, generation)) return;
        try {
          const poster = new File([blob], 'poster.jpg', { type: 'image/jpeg' });
          const uploaded = await opts.upload(poster, target());
          if (!current(localId, generation)) return;
          dispatch({ type: 'poster', localId, generation, url: uploaded.url });
        } catch (err) {
          // A poster is a nice-to-have — never the user's problem; the server job fills it later.
          console.warn('[upload-queue] poster upload failed:', err);
        }
      });
    },
    attachOriginal(localId, file) {
      const generation = generationOf(localId);
      if (generation < 0) return;
      void onUpload(async () => {
        if (!current(localId, generation)) return;
        try {
          const uploaded = await opts.upload(file, target());
          if (!current(localId, generation)) return;
          dispatch({ type: 'source', localId, generation, url: uploaded.url });
        } catch (err) {
          console.warn('[upload-queue] original upload failed (the render is the post):', err);
        }
      });
    },
    attachBlur(localId, hash) {
      dispatch({ type: 'blur', localId, hash });
    },
    device: onDevice,
    fileFor: localId => files.get(localId) ?? null,
    originalFor: localId => originals.get(localId) ?? null,
    previewFor: localId => previews.get(localId),
    itemFor: localId => state[localId],
    snapshot: () => state,
    waitFor(localId) {
      const item = state[localId];
      if (!item) return Promise.reject(new Error('Unknown upload'));
      if (isSettled(item)) return Promise.resolve(item);
      return new Promise(resolve => {
        const list = waiters.get(localId) ?? [];
        list.push(resolve);
        waiters.set(localId, list);
      });
    },
    async settle() {
      // Work enqueued while waiting (a poster after its video) is waited for too.
      let seen: Promise<void> | null = null;
      while (seen !== uploadChain) {
        seen = uploadChain;
        await seen;
        await deviceChain;
      }
      return settleSummary(Object.values(state));
    },
    async resumeFromStash() {
      const store = stash();
      if (!store) return { restored: [], lost: 0 };
      void store.sweepExpired().catch(() => undefined);
      const entries = await store.listSession(opts.sessionId).catch(() => []);
      const restored: Array<{ item: QueueItem; file: File; place: StashPlace | null }> = [];
      for (const entry of entries) {
        if (destroyed) break;
        if (state[entry.localId]) continue;
        restored.push({ item: track(entry.localId, entry.file), file: entry.file, place: entry.place });
      }
      return { restored, lost: 0 };
    },
    clearStash() {
      void stash()?.clearSession(opts.sessionId).catch(() => undefined);
    },
    destroy() {
      destroyed = true;
      unsubscribeOnline();
      for (const url of previews.values()) URL.revokeObjectURL(url);
      previews.clear();
      files.clear();
      originals.clear();
      waiters.clear();
    },
  };
  return queue;
}
