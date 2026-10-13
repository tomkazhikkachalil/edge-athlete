'use client';

import { useEffect, useRef } from 'react';

// ── While the worker still owes a playable file (video posters PR 8) ────────
// A post whose media reads `processing` was just posted from an iPhone: the
// HEVC clip is being converted by the media worker (every minute, a few
// minutes at most). For a FRESH post — under ten minutes old — the card asks
// the single-post read every 15 s for up to 3 min and hands the parent the
// media when the server answers without `processing`; everything older
// refreshes on the next load (the poll is for the person who just posted and
// is looking at their card). One poller per card, cleared on unmount.

export const PROCESSING_POLL_MS = 15_000;
export const PROCESSING_POLL_MAX_MS = 3 * 60_000;
export const PROCESSING_FRESH_MS = 10 * 60_000;

export interface ProcessingMedia {
  id: string;
  processing?: boolean;
}

/** Pure: does this post deserve a poller right now? */
export function shouldPollProcessing(media: ReadonlyArray<ProcessingMedia> | undefined, createdAt: string | undefined, now: number): boolean {
  if (!media || !media.some(m => m.processing)) return false;
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(created)) return false;
  return now - created < PROCESSING_FRESH_MS;
}

export function useProcessingRefresh<M extends ProcessingMedia>(
  postId: string,
  media: ReadonlyArray<M> | undefined,
  createdAt: string | undefined,
  onMedia: (media: M[]) => void
): void {
  const onMediaRef = useRef(onMedia);
  const mediaRef = useRef(media);
  useEffect(() => { onMediaRef.current = onMedia; mediaRef.current = media; }, [onMedia, media]);
  // Pure in render: WHETHER any media is processing; the clock is read inside the effect.
  const hasProcessing = !!media?.some(m => m.processing);
  useEffect(() => {
    if (!hasProcessing || !shouldPollProcessing(mediaRef.current, createdAt, Date.now())) return;
    let cancelled = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/posts?postId=${encodeURIComponent(postId)}`, { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as { post?: { media?: M[] } };
          const next = body.post?.media;
          if (!cancelled && Array.isArray(next) && !next.some(m => m.processing)) {
            onMediaRef.current(next);
            return;
          }
        }
      } catch {
        /* the next tick asks again */
      }
      if (!cancelled && Date.now() - started < PROCESSING_POLL_MAX_MS) timer = setTimeout(tick, PROCESSING_POLL_MS);
    };
    timer = setTimeout(tick, PROCESSING_POLL_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [hasProcessing, createdAt, postId]);
}
