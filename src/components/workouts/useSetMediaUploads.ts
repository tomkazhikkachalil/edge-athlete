'use client';

/**
 * The one upload queue of a workout screen (workout capture round, Oct 8
 * 2026). A captured clip becomes a tile at once; its bytes go to IndexedDB;
 * the upload runs here, one at a time, in the background; the set's
 * `pending:<localId>` entry becomes the stored URL when it lands. The
 * recorder's photo path (RecordActivityScreen) is the model.
 *
 * What the hook owns: the Files (a ref), the previews (object URLs), each
 * clip's status, the promise chain. What it does NOT own: the exercises —
 * it reads the LATEST through `getExercises` and writes through `commit`
 * (the screen's `mutate`: state → draft → debounced sync), so a clip that
 * lands after the user re-ordered or deleted sets finds its entry by URL,
 * never by index.
 *
 * On mount it resumes: every pending id still in the exercises is looked
 * up in the stash; bytes found → preview + upload, no prompt; none found
 * (the stash failed, or the clip was from another device) → the entry is
 * removed and ONE toast says so. Never `Promise.all` over uploads — the
 * Sep 3 2026 lesson (N concurrent phone encodes = a reloaded tab).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EntryExercise, SetMedia } from '@/lib/workouts/entries';
import { MAX_MEDIA_PER_SET } from '@/lib/workouts/entries';
import { openMediaStash, type MediaStash, type StashPlace } from '@/lib/workouts/media-stash';
import {
  pendingIdOf,
  pendingLocalIds,
  pendingUrl,
  reattachPendingMedia,
  removePendingMedia,
  replacePendingMedia,
} from '@/lib/workouts/set-media-pending';

export type SetMediaStatus = 'pending' | 'failed';

export interface SetMediaUploads {
  /** Pending entries to append to a set — the caller patches the set; the
   *  hook has already stashed the bytes (with the clip's PLACE, so a resume
   *  can put the entry back if the server copy won the reload without it)
   *  and queued the upload. */
  register(files: File[], place: StashPlace): SetMedia[];
  /** Re-queue a failed clip. */
  retry(localId: string): void;
  /** The clip is leaving its set (the caller removes the entry): stop
   *  tracking it, drop its bytes and preview. */
  forget(url: string): void;
  /** The pencil on a pending/failed tile edited the clip: the edited file
   *  replaces the queued one under the same localId. */
  replaceWithEdited(localId: string, file: File, previewUrl: string): void;
  /** The in-memory File of a pending clip (the pencil opens the editor on
   *  it — no fetch), or null when the bytes are not on this device. */
  fileFor(url: string): File | null;
  previewFor(url: string): string | undefined;
  statusFor(url: string): SetMediaStatus | undefined;
  pendingCount: number;
  failedCount: number;
  /** Resolves when nothing is uploading, with how many clips stayed failed
   *  (read synchronously — the caller's React state is stale right after the
   *  await). */
  settle(): Promise<{ failed: number }>;
  /** Discard / finish: every stashed byte of this session goes. */
  clearStash(): void;
}

interface Options {
  sessionId: string;
  getExercises: () => EntryExercise[];
  commit: (next: EntryExercise[]) => void;
  notify: (title: string, message: string) => void;
}

/** Keyed by localId while the clip is pending or failed; by the STORED url
 *  once it landed (status 'stored' — only the preview is kept, so the tile
 *  keeps showing the local bytes until the row is re-read). */
interface Tracked {
  status: SetMediaStatus | 'stored';
  preview?: string;
}

// Per-session uniqueness is all a localId needs. Not `crypto.randomUUID`:
// Safari 15.4+, below the iOS 15 floor (the gate flagged it).
const newLocalId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function useSetMediaUploads({ sessionId, getExercises, commit, notify }: Options): SetMediaUploads {
  const stashRef = useRef<MediaStash | null | undefined>(undefined);
  const stash = () => {
    if (stashRef.current === undefined) {
      try { stashRef.current = openMediaStash(); } catch { stashRef.current = null; }
    }
    return stashRef.current;
  };
  const filesRef = useRef(new Map<string, File>());
  /** Upload generation per localId — an edit or a forget bumps it so a
   *  landing upload of the OLD bytes is ignored. */
  const generationRef = useRef(new Map<string, number>());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [tracked, setTracked] = useState<Record<string, Tracked>>({});
  const trackedRef = useRef(tracked);
  useEffect(() => { trackedRef.current = tracked; }, [tracked]);
  /** The statuses, written SYNCHRONOUSLY beside the state — `settle()` reads
   *  it the moment the queue drains, before React has re-rendered. */
  const statusMapRef = useRef(new Map<string, SetMediaStatus>());

  const latest = useRef({ getExercises, commit, notify });
  useEffect(() => { latest.current = { getExercises, commit, notify }; }, [getExercises, commit, notify]);

  const setStatus = useCallback((localId: string, status: SetMediaStatus | 'stored' | null, preview?: string) => {
    if (status === 'pending' || status === 'failed') statusMapRef.current.set(localId, status);
    else statusMapRef.current.delete(localId);
    setTracked(prev => {
      const next = { ...prev };
      if (status === null) delete next[localId];
      else next[localId] = { status, preview: preview ?? prev[localId]?.preview };
      return next;
    });
  }, []);

  const enqueue = useCallback((localId: string, file: File) => {
    const generation = (generationRef.current.get(localId) ?? 0) + 1;
    generationRef.current.set(localId, generation);
    queueRef.current = queueRef.current.then(async () => {
      if (generationRef.current.get(localId) !== generation) return; // superseded
      try {
        const uploaded = await uploadPostMedia(file);
        if (generationRef.current.get(localId) !== generation) return;
        const { getExercises: read, commit: write } = latest.current;
        const next = replacePendingMedia(read(), localId, uploaded.url);
        if (next !== read()) write(next);
        // The preview moves under the STORED url and keeps showing until the
        // row is re-read (a thumbnail cannot show a private-bucket URL on its own).
        statusMapRef.current.delete(localId);
        setTracked(prev => {
          const { [localId]: done, ...rest } = prev;
          return done?.preview ? { ...rest, [uploaded.url]: { status: 'stored', preview: done.preview } } : rest;
        });
        filesRef.current.delete(localId);
        generationRef.current.delete(localId);
        void stash()?.remove(sessionId, localId).catch(() => undefined);
      } catch (err) {
        if (generationRef.current.get(localId) !== generation) return;
        setStatus(localId, 'failed');
        latest.current.notify('Upload failed', err instanceof Error ? err.message : 'The clip is still here — tap Retry.');
      }
    });
  }, [sessionId, setStatus]);

  const register = useCallback((files: File[], place: StashPlace): SetMedia[] => {
    const entries: SetMedia[] = [];
    for (const file of files) {
      const localId = newLocalId();
      filesRef.current.set(localId, file);
      const preview = URL.createObjectURL(file);
      setStatus(localId, 'pending', preview);
      entries.push({ url: pendingUrl(localId), type: file.type.startsWith('video/') ? 'video' : 'image' });
      void stash()?.save(sessionId, localId, file, Date.now(), place).catch(() => undefined);
      enqueue(localId, file);
    }
    return entries;
  }, [enqueue, sessionId, setStatus]);

  const retry = useCallback((localId: string) => {
    const file = filesRef.current.get(localId);
    if (!file) return;
    setStatus(localId, 'pending');
    enqueue(localId, file);
  }, [enqueue, setStatus]);

  const forget = useCallback((url: string) => {
    const localId = pendingIdOf(url);
    const key = localId ?? url;
    const preview = trackedRef.current[key]?.preview;
    if (preview) URL.revokeObjectURL(preview);
    setStatus(key, null);
    if (localId) {
      generationRef.current.set(localId, (generationRef.current.get(localId) ?? 0) + 1); // a landing upload is ignored
      filesRef.current.delete(localId);
      void stash()?.remove(sessionId, localId).catch(() => undefined);
    }
  }, [sessionId, setStatus]);

  const replaceWithEdited = useCallback((localId: string, file: File, previewUrl: string) => {
    const old = trackedRef.current[localId]?.preview;
    if (old && old !== previewUrl) URL.revokeObjectURL(old);
    filesRef.current.set(localId, file);
    setStatus(localId, 'pending', previewUrl);
    void stash()?.save(sessionId, localId, file).catch(() => undefined);
    enqueue(localId, file);
  }, [enqueue, sessionId, setStatus]);

  // Resume after a reload: the pending ids still in the sets look for their
  // bytes — and the stash's clips whose ENTRY is gone (the server copy won the
  // reload after the stripped snapshot landed) are put back in their place.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const store = stash();
    let cancelled = false;
    // Clips older than the stash's 48 h (abandoned workouts) are dropped
    // across every session — the stash never grows without bound.
    void store?.sweepExpired().catch(() => {});
    (async () => {
      const { getExercises: read, commit: write } = latest.current;
      let lost = 0;
      // The working snapshot is carried in a LOCAL — `read()` goes through a
      // ref that React refreshes only after the next render, so a write made
      // here is not visible to a read made in the same tick.
      let current = read();
      // 1. Orphaned bytes → their entry, by place (exercise name + set number).
      const stashed = store ? await store.listSession(sessionId).catch(() => []) : [];
      if (cancelled) return;
      const present = new Set(pendingLocalIds(current));
      for (const entry of stashed) {
        if (present.has(entry.localId)) continue;
        const type = entry.file.type.startsWith('video/') ? 'video' : 'image';
        const next = entry.place
          ? reattachPendingMedia(current, { localId: entry.localId, type, ...entry.place }, MAX_MEDIA_PER_SET)
          : current;
        if (next !== current) {
          current = next;
          write(next);
        } else {
          lost += 1; // no place, the place is gone, or the set is full — the bytes go
          void store?.remove(sessionId, entry.localId).catch(() => undefined);
        }
      }
      // 2. Every pending id now in the sets looks for its bytes.
      const ids = pendingLocalIds(current);
      for (const localId of ids) {
        const file = store ? await store.load(sessionId, localId).catch(() => null) : null;
        if (cancelled) return;
        if (file) {
          filesRef.current.set(localId, file);
          setStatus(localId, 'pending', URL.createObjectURL(file));
          enqueue(localId, file);
        } else {
          lost += 1;
          const next = removePendingMedia(current, localId);
          if (next !== current) {
            current = next;
            write(next);
          }
        }
      }
      if (lost > 0) {
        latest.current.notify(
          lost === 1 ? 'A clip could not be recovered' : `${lost} clips could not be recovered`,
          'It was taken before the page reloaded and its file is no longer on this device.'
        );
      }
    })();
    return () => { cancelled = true; };
  }, [enqueue, sessionId, setStatus]);

  // Revoke every preview when the screen unmounts.
  useEffect(() => {
    return () => {
      Object.values(trackedRef.current).forEach(t => { if (t.preview) URL.revokeObjectURL(t.preview); });
    };
  }, []);

  const counts = useMemo(() => {
    let pending = 0;
    let failed = 0;
    for (const t of Object.values(tracked)) {
      if (t.status === 'pending') pending += 1;
      else if (t.status === 'failed') failed += 1;
    }
    return { pending, failed };
  }, [tracked]);

  const settle = useCallback(
    () => queueRef.current.then(() => ({ failed: [...statusMapRef.current.values()].filter(s => s === 'failed').length })),
    []
  );
  const clearStash = useCallback(() => { void stash()?.clearSession(sessionId).catch(() => undefined); }, [sessionId]);

  const fileFor = useCallback((url: string) => {
    const localId = pendingIdOf(url);
    return localId ? filesRef.current.get(localId) ?? null : null;
  }, []);
  const previewFor = useCallback((url: string) => tracked[pendingIdOf(url) ?? url]?.preview, [tracked]);
  const statusFor = useCallback((url: string): SetMediaStatus | undefined => {
    const localId = pendingIdOf(url);
    if (!localId) return undefined;
    const status = tracked[localId]?.status;
    // A pending entry the hook does not know yet (the resume effect has not
    // run, or the bytes were never on this device) reads as pending — the
    // tile shows "Uploading" rather than a broken thumbnail.
    return status === 'failed' ? 'failed' : 'pending';
  }, [tracked]);

  return useMemo(
    () => ({
      register, retry, forget, replaceWithEdited, fileFor, previewFor, statusFor,
      pendingCount: counts.pending, failedCount: counts.failed, settle, clearStash,
    }),
    [register, retry, forget, replaceWithEdited, fileFor, previewFor, statusFor, counts, settle, clearStash]
  );
}
