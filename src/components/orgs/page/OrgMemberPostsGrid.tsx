'use client';

import { useEffect, useState } from 'react';
import { Images } from 'lucide-react';
import BubbleCard from '@/components/bubbles/BubbleCard';
import LargerWindow from '@/components/bubbles/LargerWindow';
import MediaGridItem, { type MediaItem } from '@/components/media/MediaGridItem';
import PostDetailModal from '@/components/PostDetailModal';
import type { OrgSide } from './types';

// "From members" — Org Pages R5 (Sep 8/9 2026): the org's members' public
// posts with media, as a wall of the profile page's own tiles
// (MediaGridItem → PostDetailModal with prev/next, exactly the
// ProfileMediaTabs idiom). The read is the posts route's `?org=` arm — the
// org-lens rule (post public AND author public, published only) applied to
// ONE org's people; the route decides who may read (a private org answers
// members only; a 403 renders nothing here). The client never filters:
// what the API returns is showable. 12 newest on the face; "See all"
// opens a LargerWindow that pages by cursor.

interface ApiPost {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  round_id?: string | null;
  visibility: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  tags?: string[] | null;
  hashtags?: string[] | null;
  profile: { id: string; first_name: string | null; last_name: string | null; full_name: string | null; avatar_url: string | null };
  media: Array<{ id: string; media_url: string; media_type: string; thumbnail_url: string | null; display_order: number }>;
  golf_round?: MediaItem['golf_round'];
}

/** The posts route's post → the profile grid's tile item. */
function toMediaItem(p: ApiPost, viewerId: string | undefined): MediaItem {
  return {
    id: p.id,
    caption: p.caption,
    sport_key: p.sport_key,
    stats_data: p.stats_data,
    round_id: p.round_id ?? null,
    visibility: p.visibility,
    created_at: p.created_at,
    profile_id: p.profile.id,
    profile_first_name: p.profile.first_name,
    profile_last_name: p.profile.last_name,
    profile_full_name: p.profile.full_name,
    profile_avatar_url: p.profile.avatar_url,
    media_count: p.media.length,
    likes_count: p.likes_count,
    comments_count: p.comments_count,
    saves_count: p.saves_count,
    tags: p.tags ?? null,
    hashtags: p.hashtags ?? null,
    is_own_post: !!viewerId && viewerId === p.profile.id,
    is_tagged: false,
    media: p.media,
    golf_round: p.golf_round ?? null,
  } as MediaItem;
}

const FACE_LIMIT = 12;
const PAGE_LIMIT = 24;

interface OrgMemberPostsGridProps {
  side: OrgSide;
  orgId: string;
  viewerId: string | undefined;
  canManage: boolean;
  staggerIndex: number;
}

export default function OrgMemberPostsGrid({ side, orgId, viewerId, canManage, staggerIndex }: OrgMemberPostsGridProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const base = `/api/posts?org=${side}:${encodeURIComponent(orgId)}&withMedia=1`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // An EMPTY cursor = "first keyset page": the response carries
        // nextCursor so the window can continue.
        const res = await fetch(`${base}&limit=${FACE_LIMIT}&cursor=`);
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
    return () => { cancelled = true; };
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
  if (items.length === 0) {
    // Zeros render honestly for managers; nothing for anyone else.
    if (!canManage) return null;
    return (
      <BubbleCard span="lg" icon={Images} label="From members" staggerIndex={staggerIndex} rootAttrs={{ 'data-org-bubble': 'posts' }}>
        <p className="text-sm text-muted">Members’ public posts with photos appear here once they share rounds.</p>
      </BubbleCard>
    );
  }

  const navigate = (direction: 'prev' | 'next') => {
    setSelected(i => {
      if (i === null) return i;
      const next = direction === 'next' ? i + 1 : i - 1;
      return next >= 0 && next < items.length ? next : i;
    });
  };

  const grid = (list: MediaItem[]) => (
    <div className="grid grid-cols-3 gap-2" data-org-posts={list.length}>
      {list.map((item, index) => (
        <MediaGridItem key={item.id} item={item} viewerId={viewerId} onClick={() => setSelected(index)} />
      ))}
    </div>
  );

  return (
    <>
      <BubbleCard span="lg" icon={Images} label="From members" staggerIndex={staggerIndex} rootAttrs={{ 'data-org-bubble': 'posts' }}>
        {grid(items.slice(0, FACE_LIMIT))}
        {(items.length > FACE_LIMIT || nextCursor) && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 flex min-h-[44px] w-full items-center justify-end text-xs font-semibold text-brand-fg hover:text-brand-fg-strong"
          >
            See all →
          </button>
        )}
      </BubbleCard>
      {open && (
        <LargerWindow title="From members" windowKey="posts" onClose={() => setOpen(false)}>
          {grid(items)}
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
        </LargerWindow>
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
