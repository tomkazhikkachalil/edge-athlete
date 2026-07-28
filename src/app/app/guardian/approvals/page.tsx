'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName } from '@/lib/formatters';

// ── Guardian approval queue ──────────────────────────────────────────────────
// Pending posts across all of the guardian's managed athletes, oldest first.
// Decisions go through the existing PATCH /api/posts approve/reject actions,
// which re-verify the guardian's profile_access row server-side per call.

interface PendingMedia {
  id: string;
  media_url: string;
  media_type: string;
  thumbnail_url: string | null;
  display_order: number;
}

interface PendingPost {
  id: string;
  profile_id: string;
  caption: string | null;
  sport_key: string | null;
  created_at: string;
  post_media: PendingMedia[];
  profiles: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    handle: string | null;
    avatar_url: string | null;
  } | null;
}

export default function GuardianApprovalsPage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [posts, setPosts] = useState<PendingPost[]>([]);
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guardian/pending-posts');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load pending posts');
      setPosts(data.posts ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load pending posts');
    } finally {
      setState('ready');
    }
  }, []);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [loading, initialAuthCheckComplete, user, router]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const decide = async (postId: string, action: 'approve' | 'reject') => {
    setActing(postId);
    setError('');
    try {
      const res = await fetch('/api/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update the post');
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the post');
    } finally {
      setActing('');
    }
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-violet-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-violet-50">
      <BrandBar />
      <main className="flex-grow w-full max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl sm:text-2xl font-bold text-violet-800 mb-1">Approval queue</h1>
        <p className="text-sm text-gray-600 mb-6">
          Posts your athletes have created are held here until you approve them.
          Nothing is visible to anyone else until you do.
        </p>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        {state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto my-12"></div>
        ) : posts.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">
            <i className="fas fa-circle-check text-violet-400 text-2xl mb-2 block"></i>
            All caught up — no posts are waiting for approval.
          </div>
        ) : (
          posts.map(post => {
            const athleteName = formatDisplayName(
              post.profiles?.first_name, null, post.profiles?.last_name, post.profiles?.full_name
            );
            const media = [...(post.post_media ?? [])].sort(
              (a, b) => a.display_order - b.display_order
            );
            return (
              <div key={post.id} className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{athleteName}</p>
                    {post.profiles?.handle && (
                      <p className="text-xs text-gray-500">@{post.profiles.handle}</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(post.created_at).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                </div>

                {post.caption && (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap mb-3">{post.caption}</p>
                )}

                {media.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-3">
                    {media.map(m => (
                      <div key={m.id} className="relative w-24 h-24 rounded-md overflow-hidden bg-gray-100">
                        {m.media_type === 'video' ? (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <i className="fas fa-video text-xl"></i>
                          </div>
                        ) : (
                          <Image
                            src={m.thumbnail_url || m.media_url}
                            alt="Post media"
                            fill
                            sizes="96px"
                            className="object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => decide(post.id, 'approve')}
                    disabled={acting === post.id}
                    className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 transition disabled:opacity-50"
                  >
                    {acting === post.id ? (
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                    ) : (
                      <i className="fas fa-check mr-2"></i>
                    )}
                    Approve
                  </button>
                  <button
                    onClick={() => decide(post.id, 'reject')}
                    disabled={acting === post.id}
                    className="border border-red-300 text-red-600 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-50 transition disabled:opacity-50"
                  >
                    <i className="fas fa-xmark mr-2"></i>
                    Reject
                  </button>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
