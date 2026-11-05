'use client';

import { useEffect, useState } from 'react';
import { AddVideoLink, VideoCardGrid } from '@/components/videos/VideoCards';
import type { VideoView } from '@/lib/videos/types';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; videos: VideoView[]; canAdd: boolean };

interface Props {
  /** The context's query string for GET /api/videos — `profileId=…`, `side=…&orgId=…`, `sportEventId=…`, `contestId=…`. */
  query: string;
  /** Where "Add a full game" goes for a manager (the API's `can_add` decides whether it shows). */
  addHref: string;
  /** What a non-manager reads at zero. */
  emptyCopy: string;
  /** What a manager reads at zero. */
  emptyManagerCopy?: string;
  /** Re-fetch when this changes (a parent's reload key). */
  version?: number;
  onLoaded?: (count: number, canAdd: boolean) => void;
  /** A read-only strip (the live page): render nothing at zero, even for a manager. */
  hideWhenEmpty?: boolean;
  /** The door lives elsewhere on this surface. */
  hideDoor?: boolean;
}

/**
 * One context's videos (Videos program, 296): the list from /api/videos,
 * the cards, and the manager's door. Every surface — the profile tab, the
 * event tab, the contest section — is this component over its own query;
 * the org bubble reads through its own hook and renders the same cards.
 */
export default function VideosGrid({ query, addHref, emptyCopy, emptyManagerCopy, version = 0, onLoaded, hideWhenEmpty = false, hideDoor = false }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    (async (): Promise<Load> => {
      try {
        const res = await fetch(`/api/videos?${query}`, { cache: 'no-store' });
        if (!res.ok) return { state: 'error' };
        const body = (await res.json()) as { videos: VideoView[]; can_add: boolean };
        return { state: 'ready', videos: body.videos, canAdd: body.can_add };
      } catch {
        return { state: 'error' };
      }
    })().then(next => {
      if (!live) return;
      setLoad(next);
      if (next.state === 'ready') onLoaded?.(next.videos.length, next.canAdd);
    });
    return () => {
      live = false;
    };
    // onLoaded is a parent's setter; the query and the version are the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, version]);

  if (load.state === 'loading') {
    if (hideWhenEmpty) return null;
    return <p className="py-6 text-center text-sm text-muted" role="status" aria-live="polite" data-videos-loading="">Loading videos…</p>;
  }
  if (load.state === 'error') {
    if (hideWhenEmpty) return null;
    return <p className="py-6 text-center text-sm text-muted" data-videos-error="">Could not load the videos. Check your connection and try again.</p>;
  }
  const { videos, canAdd } = load;
  if (hideWhenEmpty && videos.length === 0) return null;
  return (
    <div className="space-y-4" data-videos={videos.length}>
      {canAdd && !hideDoor && (
        <div className="flex justify-end">
          <AddVideoLink href={addHref} />
        </div>
      )}
      {videos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted" data-videos-empty="">{canAdd && emptyManagerCopy ? emptyManagerCopy : emptyCopy}</p>
      ) : (
        <VideoCardGrid videos={videos} />
      )}
    </div>
  );
}
