'use client';

import { useEffect, useState } from 'react';
import MediaGridItem, { type MediaItem } from '@/components/media/MediaGridItem';
import PostDetailModal from '@/components/PostDetailModal';
import { toMediaItem, type ApiPost } from '@/components/orgs/page/OrgMemberPostsGrid';

// ── "Posts from this event" (Contest Place E2) ───────────────────────────
// The org page's members' grid, pointed at one contest: GET /api/posts?
// contest= answers the public, published posts whose rounds were counted
// here (the org-lens visibility rule — anonymous-visible by construction).
// Tiles open the house PostDetailModal. Renders nothing while loading or
// when the API says no (pre-181 the filter answers empty) — the section
// around it is gated on the view's count, so the heading never sits over
// an empty grid for long.

const PAGE_LIMIT = 24;

interface Props {
  contestId: string;
  viewerId?: string;
}

export default function ContestPosts({ contestId, viewerId }: Props) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const base = `/api/posts?contest=${encodeURIComponent(contestId)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}&limit=${PAGE_LIMIT}&cursor=`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { posts: ApiPost[]; nextCursor?: string | null };
        if (!cancelled) {
          setItems(body.posts.map(p => toMediaItem(p, viewerId)));
          setNextCursor(body.nextCursor ?? null);
        }
      } catch {
        /* additive — nothing renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, viewerId]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`${base}&limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(nextCursor)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { posts: ApiPost[]; nextCursor?: string | null };
      setItems(prev => [...(prev ?? []), ...body.posts.map(p => toMediaItem(p, viewerId))]);
      setNextCursor(body.nextCursor ?? null);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  };

  if (!items) return null;
  if (items.length === 0) return <p className="text-sm text-muted">No public posts yet.</p>;

  const navigate = (direction: 'prev' | 'next') => {
    setSelected(i => {
      if (i === null) return i;
      const next = direction === 'next' ? i + 1 : i - 1;
      return next >= 0 && next < items.length ? next : i;
    });
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-2" data-contest-post-tiles={items.length}>
        {items.map((item, index) => (
          <MediaGridItem key={item.id} item={item} viewerId={viewerId} onClick={() => setSelected(index)} />
        ))}
      </div>
      {nextCursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-lg border border-border-strong text-sm font-medium text-secondary hover:bg-surface-sunken disabled:opacity-60"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
      <PostDetailModal
        postId={selected !== null ? items[selected]?.id ?? null : null}
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        onNavigate={navigate}
        currentUserId={viewerId}
        showNavigation={items.length > 1}
      />
    </>
  );
}
