'use client';

/**
 * The one upload queue of a workout screen (workout capture round, Oct 8
 * 2026) — since Oct 13 2026 an ADAPTER over the house's queue
 * (src/lib/media/upload-queue.ts, video posters PR 2b) with its public API
 * kept verbatim: a captured clip becomes a tile at once; its bytes go to
 * IndexedDB; the upload runs one at a time in the background; the set's
 * `pending:<localId>` entry becomes the stored URL when it lands; a video
 * clip's POSTER is grabbed after the tile (the poster plan's one second in)
 * and written onto the entry — found by URL, never by index — when it lands.
 *
 * What the adapter owns: the mapping between a set's URLs and the queue's
 * ids, the previews by STORED url (the tile keeps showing the local bytes
 * until the row is re-read), the resume (the stash's clips whose entry is
 * gone are put back by their PLACE; a pending id with no bytes is removed
 * and ONE toast says so). What it does NOT own: the exercises — it reads the
 * LATEST through `getExercises` and writes through `commit`.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EntryExercise, SetMedia } from '@/lib/workouts/entries';
import { MAX_MEDIA_PER_SET } from '@/lib/workouts/entries';
import type { StashPlace } from '@/lib/workouts/media-stash';
import {
  patchMediaByUrl,
  pendingIdOf,
  pendingLocalIds,
  pendingUrl,
  reattachPendingMedia,
  removePendingMedia,
  replacePendingMedia,
} from '@/lib/workouts/set-media-pending';
import { useMediaUploadQueue } from '@/components/media/useMediaUploadQueue';
import { grabPosterInto } from '@/components/media/grab-poster';
import type { QueueItem } from '@/lib/media/upload-queue';

export type SetMediaStatus = 'pending' | 'failed' | 'processing';

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

export function useSetMediaUploads({ sessionId, getExercises, commit, notify }: Options): SetMediaUploads {
  const latest = useRef({ getExercises, commit, notify });
  useEffect(() => { latest.current = { getExercises, commit, notify }; }, [getExercises, commit, notify]);
  /** The preview of a clip that LANDED, by its stored URL. */
  const previewByUrl = useRef(new Map<string, string>());
  /** Stored URLs whose poster has been written onto the entry. */
  const postersWritten = useRef(new Set<string>());

  const onStored = useCallback((item: QueueItem) => {
    const { getExercises: read, commit: write } = latest.current;
    if (!item.storedUrl) return;
    const next = replacePendingMedia(read(), item.localId, item.storedUrl);
    if (next !== read()) write(next);
  }, []);

  const uploads = useMediaUploadQueue({ sessionId, onStored, notify });
  const { queue, items } = uploads;

  // A landed clip keeps its local preview under the STORED url; a poster that
  // landed after its clip is written onto the entry, by URL.
  useEffect(() => {
    const { getExercises: read, commit: write } = latest.current;
    let current = read();
    let changed = false;
    for (const item of Object.values(items)) {
      if (!item.storedUrl) continue;
      const preview = queue.previewFor(item.localId);
      if (preview) previewByUrl.current.set(item.storedUrl, preview);
      if (item.posterUrl && !postersWritten.current.has(item.storedUrl)) {
        const next = patchMediaByUrl(current, item.storedUrl, { thumbnailUrl: item.posterUrl });
        if (next !== current) {
          current = next;
          changed = true;
        }
        postersWritten.current.add(item.storedUrl);
      }
    }
    if (changed) write(current);
  }, [items, queue]);

  // A video clip's poster: grabbed on the device chain after the tile (the
  // one grab every host shares — grab-poster.ts); a miss leaves the clip
  // without one (the server job fills it later).
  const grabPoster = useCallback((localId: string, file: File) => grabPosterInto(queue, localId, file), [queue]);

  const register = useCallback((files: File[], place: StashPlace): SetMedia[] => {
    const registered = queue.register(files, place);
    registered.forEach((item, i) => grabPoster(item.localId, files[i]));
    return registered.map(item => ({ url: pendingUrl(item.localId), type: item.kind }));
  }, [queue, grabPoster]);

  const retry = useCallback((localId: string) => queue.retry(localId), [queue]);

  const forget = useCallback((url: string) => {
    const localId = pendingIdOf(url);
    if (localId) queue.forget(localId);
    else previewByUrl.current.delete(url);
  }, [queue]);

  const replaceWithEdited = useCallback((localId: string, file: File, previewUrl: string) => {
    queue.replaceWithEdited(localId, file, { previewUrl });
    grabPoster(localId, file);
  }, [queue, grabPoster]);

  // Resume after a reload: the stash's clips whose ENTRY is gone (the server
  // copy won the reload after the stripped snapshot landed) are put back in
  // their place; every pending id still in the sets then looks for its bytes.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    let cancelled = false;
    (async () => {
      const { getExercises: read, commit: write, notify: say } = latest.current;
      const { restored } = await queue.resumeFromStash();
      if (cancelled) return;
      let lost = 0;
      // The working snapshot is carried in a LOCAL — `read()` goes through a
      // ref that React refreshes only after the next render.
      let current = read();
      const present = new Set(pendingLocalIds(current));
      const adopted = new Set<string>();
      for (const { item, file, place } of restored) {
        adopted.add(item.localId);
        if (present.has(item.localId)) continue;
        const type = file.type.startsWith('video/') ? 'video' : 'image';
        const next = place ? reattachPendingMedia(current, { localId: item.localId, type, ...place }, MAX_MEDIA_PER_SET) : current;
        if (next !== current) {
          current = next;
          write(next);
        } else {
          lost += 1; // no place, the place is gone, or the set is full — the bytes go
          queue.forget(item.localId);
        }
      }
      // A pending id with no bytes on this device leaves the set.
      for (const localId of pendingLocalIds(current)) {
        if (adopted.has(localId)) continue;
        lost += 1;
        const next = removePendingMedia(current, localId);
        if (next !== current) {
          current = next;
          write(next);
        }
      }
      // The restored video clips get their posters.
      for (const { item, file } of restored) if (!cancelled) grabPoster(item.localId, file);
      if (lost > 0) {
        say(
          lost === 1 ? 'A clip could not be recovered' : `${lost} clips could not be recovered`,
          'It was taken before the page reloaded and its file is no longer on this device.'
        );
      }
    })();
    return () => { cancelled = true; };
  }, [queue, grabPoster]);

  const counts = useMemo(() => {
    let pending = 0;
    let failed = 0;
    for (const item of Object.values(items)) {
      if (item.status === 'pending') pending += 1;
      else if (item.status === 'failed') failed += 1;
    }
    return { pending, failed };
  }, [items]);

  const settle = useCallback(async () => {
    const summary = await queue.settle();
    return { failed: summary.failed };
  }, [queue]);
  const clearStash = useCallback(() => queue.clearStash(), [queue]);

  const fileFor = useCallback((url: string) => {
    const localId = pendingIdOf(url);
    return localId ? queue.fileFor(localId) : null;
  }, [queue]);
  const previewFor = useCallback((url: string) => {
    const localId = pendingIdOf(url);
    return localId ? queue.previewFor(localId) : previewByUrl.current.get(url);
  }, [queue]);
  const statusFor = useCallback((url: string): SetMediaStatus | undefined => {
    const localId = pendingIdOf(url);
    if (!localId) return undefined;
    const status = items[localId]?.status;
    // A pending entry the queue does not know yet (the resume has not run, or
    // the bytes were never on this device) reads as pending — the tile shows
    // "Uploading" rather than a broken thumbnail.
    if (status === 'failed' || status === 'processing') return status;
    return 'pending';
  }, [items]);

  return useMemo(
    () => ({
      register, retry, forget, replaceWithEdited, fileFor, previewFor, statusFor,
      pendingCount: counts.pending, failedCount: counts.failed, settle, clearStash,
    }),
    [register, retry, forget, replaceWithEdited, fileFor, previewFor, statusFor, counts, settle, clearStash]
  );
}
