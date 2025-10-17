'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import PostCard from '@/components/PostCard';
import AppHeader from '@/components/AppHeader';
import type { GolfRound } from '@/types/golf';

interface PostMedia {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  display_order: number;
}

interface Profile {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

interface StatsData {
  [key: string]: string | number | boolean | null;
}

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: StatsData | null;
  visibility: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  saves_count?: number;
  profile: Profile;
  media: PostMedia[];
  likes?: { profile_id: string }[];
  saved_posts?: { profile_id: string }[];
  tags?: string[];
  hashtags?: string[];
  golf_round?: GolfRound;
}

interface SavedPost {
  id: string;
  created_at: string;
  post: Post;
}

export default function SavedPostsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [savedPosts, setSavedPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSavedPosts = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('saved_posts')
        .select(`
          id,
          created_at,
          post:posts (
            id,
            caption,
            sport_key,
            stats_data,
            visibility,
            created_at,
            likes_count,
            comments_count,
            saves_count,
            tags,
            hashtags,
            profile:profiles (
              id,
              first_name,
              middle_name,
              last_name,
              full_name,
              avatar_url
            ),
            media:post_media (
              id,
              media_url,
              media_type,
              display_order
            ),
            likes:post_likes (
              profile_id
            ),
            saved_posts (
              profile_id
            ),
            golf_round:golf_rounds (
              id,
              course,
              date,
              gross_score,
              par,
              holes,
              tee,
              total_putts,
              fir_percentage,
              gir_percentage,
              golf_holes (
                hole_number,
                par,
                distance_yards,
                strokes,
                putts
              )
            )
          )
        `)
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('Error fetching saved posts:', fetchError);
        setError('Failed to load saved posts');
        return;
      }

      // Filter out any saved posts where the post was deleted
      const validSavedPosts = (data || []).filter((sp: SavedPost) => sp.post !== null);

      setSavedPosts(validSavedPosts as SavedPost[]);
    } catch (err) {
      console.error('Error loading saved posts:', err);
      setError('An error occurred while loading saved posts');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchSavedPosts();
    } else {
      setLoading(false);
    }
  }, [user, fetchSavedPosts]);

  const handleLike = async (postId: string) => {
    if (!user) return;

    try {
      const response = await fetch('/api/posts/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, profileId: user.id })
      });

      if (response.ok) {
        const data = await response.json();
        // Update the post in state
        setSavedPosts(prevPosts =>
          prevPosts.map(sp => {
            if (sp.post.id === postId) {
              return {
                ...sp,
                post: {
                  ...sp.post,
                  likes_count: data.likesCount,
                  likes: data.action === 'liked'
                    ? [...(sp.post.likes || []), { profile_id: user.id }]
                    : (sp.post.likes || []).filter((l: { profile_id: string }) => l.profile_id !== user.id)
                }
              };
            }
            return sp;
          })
        );
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  const handleCommentCountChange = (postId: string, newCount: number) => {
    setSavedPosts(prevPosts =>
      prevPosts.map(sp => {
        if (sp.post.id === postId) {
          return {
            ...sp,
            post: {
              ...sp.post,
              comments_count: newCount
            }
          };
        }
        return sp;
      })
    );
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Sign In Required</h1>
          <p className="text-gray-600 mb-6">Please sign in to view your saved posts.</p>
          <button
            onClick={() => router.push('/login')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-600">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Unified Header */}
      <AppHeader showSearch={false} />

      {/* Page Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-4 mb-2">
            <button
              onClick={() => router.back()}
              className="text-gray-600 hover:text-gray-900"
            >
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Saved Posts</h1>
          </div>
          <p className="text-sm text-gray-600 ml-12">
            {savedPosts.length} {savedPosts.length === 1 ? 'post' : 'posts'} saved
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Saved Posts List */}
        {savedPosts.length === 0 ? (
          <div className="text-center py-12">
            <i className="far fa-bookmark text-6xl text-gray-300 mb-4"></i>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">No saved posts yet</h2>
            <p className="text-gray-500">
              Posts you save will appear here. Tap the bookmark icon on any post to save it.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {savedPosts.map((savedPost) => (
              <PostCard
                key={savedPost.id}
                post={savedPost.post}
                currentUserId={user.id}
                onLike={handleLike}
                onCommentCountChange={handleCommentCountChange}
                showActions={true}
              />
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
