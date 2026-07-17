'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getSportDefinition, getSportAdapter, type SportKey } from '@/lib/sports';
import { getStatSchema, isStatLineData, type StatLineData } from '@/lib/sports/stat-schemas';
import StatLineCard from '@/components/StatLineCard';

interface ActivityPost {
  id: string;
  caption: string | null;
  created_at: string;
  stats_data: unknown;
  profile?: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}

export default function SportActivityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [post, setPost] = useState<ActivityPost | null>(null);

  const sportKey = params.sport_key as string;
  const activityId = params.id as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const checkRoute = async () => {
      try {
        // Check if this is a valid sport
        const sportDef = getSportDefinition(sportKey as SportKey);
        const adapter = getSportAdapter(sportKey as SportKey);

        if (!sportDef) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        // For golf, redirect to the specific golf route
        if (sportKey === 'golf' && adapter.isEnabled()) {
          router.replace(`/app/sport/golf/rounds/${activityId}`);
          return;
        }

        // Stat-line sports: the activity ID is the post ID — fetch and render
        if (adapter.isEnabled() && getStatSchema(sportKey)) {
          const response = await fetch(`/api/posts/${activityId}`, {
            credentials: 'include',
          });
          if (!response.ok) {
            setNotFound(true);
            setLoading(false);
            return;
          }
          const data = await response.json();
          setPost(data.post ?? null);
          setLoading(false);
          return;
        }

        // Disabled sports: show coming soon
        setLoading(false);
      } catch (e) {
        console.error('Failed to resolve sport activity route:', e);
        setNotFound(true);
        setLoading(false);
      }
    };

    if (user?.id && sportKey && activityId) {
      checkRoute();
    }
  }, [user?.id, sportKey, activityId, router]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading activity...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Activity Not Found</h1>
          <p className="text-gray-600 mb-8">This activity does not exist or the sport is not supported yet.</p>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const sportDef = getSportDefinition(sportKey as SportKey);
  const adapter = getSportAdapter(sportKey as SportKey);
  const statLine: StatLineData | null =
    post && isStatLineData(post.stats_data) ? post.stats_data : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Back to Activity
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-section">
        {statLine ? (
          <div className="bg-white rounded-lg shadow-sm p-base">
            <div className="flex items-center gap-3 mb-4">
              <i className={`${sportDef.icon_id} text-2xl text-blue-600`} aria-hidden="true"></i>
              <div>
                <h1 className="text-h3 font-bold text-gray-900">
                  {sportDef.display_name} {getStatSchema(sportKey)?.activityNoun}
                </h1>
                {post?.profile && (
                  <p className="text-sm text-gray-600">
                    {post.profile.full_name ||
                      [post.profile.first_name, post.profile.last_name].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>
            </div>

            <StatLineCard line={statLine} />

            {post?.caption && (
              <p className="mt-4 text-gray-900 whitespace-pre-wrap">{post.caption}</p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-base">
            <div className="text-center py-12">
              <i className={`${sportDef.icon_id} text-6xl text-gray-300 mb-6`}></i>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                {sportDef.display_name} Activity Details
              </h1>
              <p className="text-gray-600 mb-6">
                {adapter.isEnabled()
                  ? 'This activity has no detailed stats attached.'
                  : `Detailed ${sportDef.display_name.toLowerCase()} activity tracking is coming soon!`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
