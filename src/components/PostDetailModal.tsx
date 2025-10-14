'use client';

import { useState, useEffect, useCallback } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import PostCard from './PostCard';

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
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch post data
  const fetchPost = useCallback(async () => {
    if (!postId) {
      console.log('[PostDetailModal] No postId, skipping fetch');
      return;
    }

    console.log('[PostDetailModal] Fetching post:', postId);
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

      // Debug: Log raw data
      console.log('[PostDetailModal] Raw data received from API:', data);

      // Fetch saved_posts status for current user
      const supabase = createSupabaseBrowserClient();
      const { data: savedPosts } = await supabase
        .from('saved_posts')
        .select('profile_id')
        .eq('post_id', postId);

      // Transform data to match PostCard interface (API already formats most of it)
      const transformedPost = {
        ...data,
        // Add saved_posts if user is logged in
        saved_posts: savedPosts || []
      };

      console.log('[PostDetailModal] Transformed data for PostCard:', transformedPost);
      console.log('[PostDetailModal] Has profile?', !!transformedPost.profile);
      console.log('[PostDetailModal] Has media?', transformedPost.media?.length);
      console.log('[PostDetailModal] Has golf_round?', !!transformedPost.golf_round);

      setPost(transformedPost);
    } catch (err: any) {
      console.error('Error fetching post:', err);
      setError(err?.message || 'Failed to load post');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  // Fetch post when modal opens or postId changes
  useEffect(() => {
    if (isOpen && postId) {
      console.log('[PostDetailModal] Modal opened, fetching post...');
      fetchPost();
    } else if (!isOpen) {
      // Reset state when modal closes
      console.log('[PostDetailModal] Modal closed, resetting state');
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
    if (!post) return;

    const isLiked = post.likes?.some((like: any) => like.profile_id === currentUserId);
    const newLikesCount = isLiked ? post.likes_count - 1 : post.likes_count + 1;

    // Optimistic update
    setPost({
      ...post,
      likes_count: newLikesCount,
      likes: isLiked
        ? post.likes.filter((like: any) => like.profile_id !== currentUserId)
        : [...(post.likes || []), { profile_id: currentUserId }]
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
        setPost((prev: any) => ({
          ...prev,
          likes_count: data.likesCount
        }));
      }
    } catch (err) {
      console.error('Error toggling like:', err);
      await fetchPost();
    }
  };

  const handleCommentCountChange = (postId: string, newCount: number) => {
    setPost((prev: any) => ({
      ...prev,
      comments_count: newCount
    }));
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
              post={post}
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
