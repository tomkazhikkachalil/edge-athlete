'use client';

import { useState, useEffect, useCallback } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import PostCard from './PostCard';

// PostDetailModal uses a flexible post type to accommodate the PostCard interface
// which includes additional fields like stats_data and media
interface PostData {
  id: string;
  profile_id: string;
  caption: string | null;
  sport_key: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  stats_data: Record<string, unknown> | null;
  profile: {
    id: string;
    full_name: string | null;
    first_name?: string | null;
    last_name?: string | null;
    avatar_url: string | null;
    handle?: string | null;
  };
  media: Array<{
    id: string;
    post_id: string;
    media_url: string;
    media_type: 'image' | 'video';
    caption?: string | null;
    position: number;
  }>;
  post_likes?: { profile_id: string }[];
  saved_posts?: { profile_id: string }[];
  golf_round?: unknown;
  [key: string]: unknown; // Allow additional properties from API
}

interface PostDetailModalProps {
  postId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  currentUserId?: string;
  showNavigation?: boolean;
  onEdit?: (postId: string) => void;
  onDelete?: (postId: string) => void;
}

export default function PostDetailModal({
  postId,
  isOpen,
  onClose,
  onNavigate,
  currentUserId,
  showNavigation = false,
  onEdit,
  onDelete
}: PostDetailModalProps) {
  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch post data
  const fetchPost = useCallback(async () => {
    if (!postId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use API endpoint which handles RLS with admin client
      const response = await fetch(`/api/posts?postId=${postId}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch post');
      }

      const { post: data } = await response.json();

      if (!data) {
        throw new Error('Post not found');
      }

      // Fetch saved_posts status for current user
      const supabase = createSupabaseBrowserClient();
      const { data: savedPosts } = await supabase
        .from('saved_posts')
        .select('profile_id')
        .eq('post_id', postId);

      // Transform data to match PostCard interface (API already formats most of it)
      const transformedPost: PostData = {
        ...data,
        stats_data: data.stats_data ?? null,
        media: data.media || [],
        // Add saved_posts if user is logged in
        saved_posts: savedPosts || []
      };

      setPost(transformedPost);
    } catch (err: unknown) {
      console.error('Error fetching post:', err);
      setError(err instanceof Error ? err.message : 'Failed to load post');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  // Fetch post when modal opens or postId changes
  useEffect(() => {
    if (isOpen && postId) {
      fetchPost();
    } else if (!isOpen) {
      // Reset state when modal closes
      setPost(null);
      setLoading(false);
      setError(null);
    }
  }, [isOpen, postId, fetchPost]);

  // Handle ESC key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Handle arrow keys for navigation
  useEffect(() => {
    if (!isOpen || !showNavigation || !onNavigate) return;

    const handleKeyNav = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onNavigate('prev');
      } else if (e.key === 'ArrowRight') {
        onNavigate('next');
      }
    };

    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [isOpen, showNavigation, onNavigate]);

  // Handle like update
  const handleLike = async (postId: string) => {
    if (!post || !currentUserId) return;

    const isLiked = post.post_likes?.some((like) => like.profile_id === currentUserId);
    const newLikesCount = isLiked ? post.likes_count - 1 : post.likes_count + 1;

    // Optimistic update
    setPost({
      ...post,
      likes_count: newLikesCount,
      post_likes: isLiked
        ? post.post_likes?.filter((like) => like.profile_id !== currentUserId)
        : [...(post.post_likes || []), { profile_id: currentUserId }]
    });

    // Call API
    try {
      const response = await fetch('/api/posts/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, profileId: currentUserId })
      });

      if (!response.ok) {
        // Revert on error
        await fetchPost();
      } else {
        const data = await response.json();
        setPost((prev) => prev ? ({
          ...prev,
          likes_count: data.likesCount
        }) : null);
      }
    } catch (err) {
      console.error('Error toggling like:', err);
      await fetchPost();
    }
  };

  const handleCommentCountChange = (postId: string, newCount: number) => {
    setPost((prev) => prev ? ({
      ...prev,
      comments_count: newCount
    }) : null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-75"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl overflow-hidden mx-4">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 w-8 h-8 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full flex items-center justify-center transition-colors"
          aria-label="Close"
        >
          <i className="fas fa-times text-sm"></i>
        </button>

        {/* Navigation Buttons */}
        {showNavigation && onNavigate && (
          <>
            <button
              onClick={() => onNavigate('prev')}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full flex items-center justify-center transition-colors"
              aria-label="Previous post"
            >
              <i className="fas fa-chevron-left"></i>
            </button>
            <button
              onClick={() => onNavigate('next')}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full flex items-center justify-center transition-colors"
              aria-label="Next post"
            >
              <i className="fas fa-chevron-right"></i>
            </button>
          </>
        )}

        {/* Content */}
        <div className="overflow-y-auto max-h-[90vh] p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <div className="text-red-500 mb-4">
                <i className="fas fa-exclamation-circle text-4xl"></i>
              </div>
              <p className="text-gray-700">{error}</p>
              <button
                onClick={fetchPost}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && post && (
            <PostCard
              post={post as never}
              currentUserId={currentUserId}
              onLike={handleLike}
              onEdit={onEdit}
              onDelete={onDelete}
              onCommentCountChange={handleCommentCountChange}
              showActions={true}
            />
          )}
        </div>
      </div>
    </div>
  );
}
