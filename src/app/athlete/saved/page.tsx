'use client';

import { useState, useEffect } from 'react';
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
  /** Attribution (090): the human author when a guardian posted on behalf. */
  created_by?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    handle: string | null;
  } | null;
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
  const { user, initialAuthCheckComplete } = useAuth();
  const [savedPosts, setSavedPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  // Inlined cancellable IIFE; direct Supabase query, so the flag is the only
  // guard against a late response landing after unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
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
              profile:profile_id (
                id,
                first_name,
                middle_name,
                last_name,
                full_name,
                avatar_url
              ),
              created_by:created_by_user_id (
                id,
                first_name,
                last_name,
                full_name,
                handle
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
          setError('Failed to load saved posts');
          return;
        }

        // Filter out any saved posts where the post was deleted
        const validSavedPosts = (data || []).filter((sp: SavedPost) => sp.post !== null);

        if (!cancelled) setSavedPosts(validSavedPosts as SavedPost[]);
      } catch (e) {
        console.error('Failed to load saved posts:', e);
        setError('An error occurred while loading saved posts');
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
      } else {
        console.error('Failed to like saved post — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to like saved post:', e);
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

  // Auth boot must win over the !user branch — otherwise a signed-in
  // user refreshing this page flashes "Sign In Required".
  if (!initialAuthCheckComplete || (user && loading)) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-2xl font-bold mb-4">Sign In Required</h1>
            <p className="text-tertiary mb-6">Please sign in to view your saved posts.</p>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Unified Header */}
      <AppHeader showSearch={false} />

      {/* Page Header */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-4 mb-2">
            <button
              onClick={() => router.back()}
              className="text-tertiary hover:text-primary"
            >
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h1 className="text-2xl font-bold text-primary">Saved Posts</h1>
          </div>
          <p className="text-sm text-tertiary ml-12">
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
            <h2 className="text-xl font-semibold text-secondary mb-2">No saved posts yet</h2>
            <p className="text-muted">
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
