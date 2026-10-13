'use client';

/**
 * React over the one upload queue (src/lib/media/upload-queue.ts). The queue
 * lives for the component's life in a ref that is only ever touched OUTSIDE
 * render (the compiler lint forbids a ref in render): the hook hands out a
 * stable facade whose methods fetch the queue when they run — from a
 * handler, an effect, a promise. The queue's state is mirrored into React
 * state for rendering; `settle()` and friends read the queue's own
 * synchronous snapshot — never the React mirror, which is stale right after
 * an await (the workout hook's lesson, Oct 8 2026).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openMediaStash } from '@/lib/workouts/media-stash';
import { getOnline, subscribeOnline } from '@/lib/net/online';
import { uploadPostMedia } from '@/lib/media/upload';
import { createUploadQueue, type PrepareResult, type QueueItem, type QueueState, type UploadQueue, type UploadStatus } from '@/lib/media/upload-queue';

interface Options {
  sessionId: string;
  /** The queue's `keepStashedAfterUpload` (the composer keeps its bytes until Post). */
  keepStashedAfterUpload?: boolean;
  targetProfileId?: () => string | undefined;
  prepare?: (file: File, localId: string) => Promise<PrepareResult | null>;
  /** An upload landed — called INSIDE the upload task, so work it enqueues on the queue (a photo's blur) is waited for by `settle()`. */
  onStored?: (item: QueueItem, queue: UploadQueue) => void;
  notify?: (title: string, message: string) => void;
}

export interface MediaUploadQueue {
  queue: UploadQueue;
  items: QueueState;
  itemFor(localId: string): QueueItem | undefined;
  statusFor(localId: string): UploadStatus | undefined;
  pendingCount: number;
  failedCount: number;
}

type Latest = Omit<Options, 'sessionId'>;

export function useMediaUploadQueue({ sessionId, keepStashedAfterUpload = false, targetProfileId, prepare, onStored, notify }: Options): MediaUploadQueue {
  const [items, setItems] = useState<QueueState>({});
  const latestRef = useRef<Latest>({ targetProfileId, prepare, onStored, notify });
  useEffect(() => { latestRef.current = { targetProfileId, prepare, onStored, notify }; }, [targetProfileId, prepare, onStored, notify]);

  const queueRef = useRef<UploadQueue | null>(null);
  const getQueue = useCallback((): UploadQueue => {
    if (!queueRef.current) {
      let stash = null;
      try { stash = openMediaStash(); } catch { stash = null; }
      queueRef.current = createUploadQueue({
        sessionId,
        stash,
        keepStashedAfterUpload,
        upload: uploadPostMedia,
        targetProfileId: () => latestRef.current.targetProfileId?.(),
        prepare: (file, localId) => (latestRef.current.prepare ? latestRef.current.prepare(file, localId) : Promise.resolve(null)),
        onChange: setItems,
        onStored: item => { if (queueRef.current) latestRef.current.onStored?.(item, queueRef.current); },
        notify: (title, message) => latestRef.current.notify?.(title, message),
        isOnline: getOnline,
        subscribeOnline,
      });
    }
    return queueRef.current;
  }, [sessionId, keepStashedAfterUpload]);

  useEffect(() => () => { queueRef.current?.destroy(); queueRef.current = null; }, []);

  // The facade: every method reaches the queue when it RUNS, never in render.
  const queue = useMemo<UploadQueue>(() => ({
    register: (files, place) => getQueue().register(files, place),
    adopt: (localId, file, place) => getQueue().adopt(localId, file, place),
    retry: localId => getQueue().retry(localId),
    forget: localId => getQueue().forget(localId),
    forgetAll: () => getQueue().forgetAll(),
    replaceWithEdited: (localId, file, extras) => getQueue().replaceWithEdited(localId, file, extras),
    attachPoster: (localId, blob) => getQueue().attachPoster(localId, blob),
    attachOriginal: (localId, file) => getQueue().attachOriginal(localId, file),
    attachBlur: (localId, hash) => getQueue().attachBlur(localId, hash),
    device: task => getQueue().device(task),
    fileFor: localId => getQueue().fileFor(localId),
    originalFor: localId => getQueue().originalFor(localId),
    previewFor: localId => getQueue().previewFor(localId),
    itemFor: localId => getQueue().itemFor(localId),
    snapshot: () => getQueue().snapshot(),
    waitFor: localId => getQueue().waitFor(localId),
    settle: () => getQueue().settle(),
    resumeFromStash: () => getQueue().resumeFromStash(),
    clearStash: () => getQueue().clearStash(),
    destroy: () => getQueue().destroy(),
  }), [getQueue]);

  return useMemo(() => {
    let pending = 0;
    let failed = 0;
    for (const item of Object.values(items)) {
      if (item.status === 'pending') pending += 1;
      else if (item.status === 'failed') failed += 1;
    }
    return {
      queue,
      items,
      itemFor: (localId: string) => items[localId],
      statusFor: (localId: string) => items[localId]?.status,
      pendingCount: pending,
      failedCount: failed,
    };
  }, [queue, items]);
}
