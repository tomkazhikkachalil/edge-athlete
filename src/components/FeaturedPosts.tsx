'use client';

import { useState, useEffect } from 'react';
import OptimizedImage from './OptimizedImage';
import PostDetailModal from './PostDetailModal';
import { formatGolfStatsSummary, formatGenericStatsSummary } from '@/lib/stats-summary';
import type { GolfRound } from '@/types/golf';

// Shape of the posts-list API response we consume (subset)
interface FeaturedPost {
  id: string;
  caption: string | null;
  stats_data: Record<string, unknown> | null;
  media: Array<{
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    display_order: number;
  }>;
  golf_round?: GolfRound | null;
}

interface FeaturedPostsProps {
  profileId: string;
  isOwnProfile: boolean;
  currentUserId?: string;
  /** Bump to refetch (e.g. after a pin/unpin elsewhere on the page). */
  refreshKey?: number;
}

/**
 * The "Featured" row: the profile's pinned posts (max MAX_PINNED_POSTS),
 * rendered above the media grid so visitors see them first. Renders nothing
 * while loading or when nothing is pinned — the row is pure progressive
 * enhancement. Privacy is enforced server-side by the posts list endpoint.
 */
export default function FeaturedPosts({
  profileId,
  isOwnProfile,
  currentUserId,
  refreshKey = 0
}: FeaturedPostsProps) {
  const [posts, setPosts] = useState<FeaturedPost[]>([]);
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  // Inlined cancellable IIFE; the caller already drives refetches through the
  // refreshKey prop, and unpinning is optimistic with a rollback.
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/posts?userId=${profileId}&pinned=true&limit=3`,
          { credentials: 'include' }
        );
        if (!response.ok) {
          if (!cancelled) setPosts([]);
          return;
        }
        const data = await response.json();
        if (!cancelled) setPosts(data.posts || []);
      } catch (e) {
        console.error('Failed to load featured posts:', e);
        if (!cancelled) setPosts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, refreshKey]);

  const handleUnpin = async (postId: string) => {
    // Optimistic removal; refetch on failure to restore truth
    const previous = posts;
    setPosts(prev => prev.filter(p => p.id !== postId));
    try {
      const response = await fetch('/api/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId, action: 'unpin' })
      });
      if (!response.ok) setPosts(previous);
    } catch (e) {
      console.error('Failed to unpin post:', e);
      setPosts(previous);
    }
  };

  if (posts.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <i className="fas fa-thumbtack text-amber-500 text-sm" aria-hidden="true"></i>
        <h3 className="text-lg font-bold text-black dark:text-primary">Featured</h3>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {posts.map(post => (
          <FeaturedTile
            key={post.id}
            post={post}
            canUnpin={isOwnProfile}
            onOpen={() => setOpenPostId(post.id)}
            onUnpin={() => handleUnpin(post.id)}
          />
        ))}
      </div>

      <PostDetailModal
        postId={openPostId}
        isOpen={!!openPostId}
        onClose={() => setOpenPostId(null)}
        currentUserId={currentUserId}
      />
    </div>
  );
}

function FeaturedTile({
  post,
  canUnpin,
  onOpen,
  onUnpin
}: {
  post: FeaturedPost;
  canUnpin: boolean;
  onOpen: () => void;
  onUnpin: () => void;
}) {
  const firstMedia = post.media && post.media.length > 0 ? post.media[0] : null;
  const isVideo = firstMedia?.media_type === 'video';

  // Text fallback for media-less posts: the STATS one-liner first, caption
  // only when there are none. Caption-first meant a captioned stat post
  // showed prose where its number should be — and a featured tile exists to
  // make someone click. Same summary helpers the media grid uses.
  let textContent: string | null = null;
  if (post.golf_round) {
    textContent = formatGolfStatsSummary(post.golf_round)?.primaryLine ?? null;
  } else if (post.stats_data) {
    textContent = formatGenericStatsSummary(post.stats_data)?.primaryLine ?? null;
  }
  if (!textContent) textContent = post.caption;

  return (
    <div className="relative group">
      <button
        onClick={onOpen}
        className="relative w-full aspect-square rounded-xl overflow-hidden bg-surface-sunken border border-border hover:border-border-strong hover:shadow-lg hover:scale-105 transition-all duration-300"
        aria-label={post.caption || 'Featured post'}
      >
        {firstMedia ? (
          isVideo ? (
            <div className="relative w-full h-full">
              <video
                src={firstMedia.media_url}
                className="w-full h-full object-cover"
                preload="metadata"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center">
                  <i className="fas fa-play text-white text-sm ml-0.5"></i>
                </div>
              </div>
            </div>
          ) : (
            <OptimizedImage
              src={firstMedia.media_url}
              alt={post.caption || 'Featured post'}
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-50 dark:from-amber-950/40 via-yellow-50 dark:via-yellow-950/40 to-amber-100 dark:to-amber-950/60 p-3">
            <p className="text-sm text-secondary line-clamp-4 text-center">
              {textContent || 'Post'}
            </p>
          </div>
        )}
      </button>

      {canUnpin && (
        <button
          onClick={onUnpin}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          title="Unpin from profile"
          aria-label="Unpin from profile"
        >
          <i className="fas fa-times text-xs"></i>
        </button>
      )}
    </div>
  );
}
