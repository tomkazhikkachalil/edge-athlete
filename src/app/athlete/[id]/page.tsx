'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import LazyImage from '@/components/LazyImage';
import AppHeader from '@/components/AppHeader';
import FollowButton from '@/components/FollowButton';
import PrivateProfileView from '@/components/PrivateProfileView';
import ProfileMediaTabs from '@/components/ProfileMediaTabs';
import FeaturedPosts from '@/components/FeaturedPosts';
import PostDetailModal from '@/components/PostDetailModal';
import FollowersModal from '@/components/FollowersModal';
import type { Profile } from '@/lib/supabase';
import AchievementPills from '@/components/achievements/AchievementPills';
import { topPills } from '@/lib/achievements/display';
import type { Achievement } from '@/lib/achievements';
// Privacy checks moved to API route
import {
  formatDisplayName,
  getInitials,
  formatSocialHandle,
  formatSocialHandleDisplay
} from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';

export default function AthleteProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const athleteId = params.id as string;
  // Share links point to /athlete/<id>?post=<postId> — open that post.
  // Without this reader every shared post link just showed the profile.
  const [deepLinkPostId, setDeepLinkPostId] = useState<string | null>(null);

  // Reading the query string is synchronisation, not a side effect.
  const [syncedParams, setSyncedParams] = useState(searchParams);
  if (syncedParams !== searchParams) {
    setSyncedParams(searchParams);
    const postParam = searchParams.get('post');
    if (postParam) setDeepLinkPostId(postParam);
  }

  // Profile data
  const [profile, setProfile] = useState<Profile | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followStats, setFollowStats] = useState({
    followersCount: 0,
    followingCount: 0,
    isFollowing: false
  });
  const [hasAccess, setHasAccess] = useState(true); // Privacy check result

  // Followers Modal state
  const [isFollowersModalOpen, setIsFollowersModalOpen] = useState(false);
  const [followersModalTab, setFollowersModalTab] = useState<'followers' | 'following'>('followers');


  // Note: seasonHighlights and performances are fetched but not currently displayed
  // These can be added to the UI in future updates

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  // Redirect to own profile if viewing own ID — carry the query string so
  // self-shared ?post= links still open the post on /athlete
  useEffect(() => {
    if (!authLoading && user && athleteId === user.id) {
      const qs = searchParams.toString();
      router.push(qs ? `/athlete?${qs}` : '/athlete');
    }
  }, [user, authLoading, athleteId, router, searchParams]);

  // Load athlete profile data
  useEffect(() => {
    if (athleteId && user) {
      loadAthleteProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, user]);

  // Guards against out-of-order responses when navigating between athlete
  // profiles (same route, new param — the component stays mounted).
  const requestSeqRef = useRef(0);

  // Hoisted function declaration, not a `const` arrow: an effect above calls it,
  // and react-hooks/immutability flags a reference to a binding declared later
  // in the body. Function declarations are hoisted, so there is no TDZ.
  async function loadAthleteProfile() {
    const seq = ++requestSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      // Load profile + achievements in parallel. The achievements API's own
      // gate ladder (owner → public → accepted follow → 403) is exactly this
      // page's privacy model, so a 403/error simply means "show none".
      const [response, achievementsResponse] = await Promise.all([
        fetch(`/api/profile?id=${athleteId}`),
        fetch(`/api/achievements?profileId=${athleteId}`, { credentials: 'include' })
          .catch(() => null),
      ]);
      if (seq !== requestSeqRef.current) return; // stale response
      if (!response.ok) {
        if (response.status === 404) {
          setError('Athlete not found');
          return;
        }
        throw new Error('Failed to load profile');
      }

      const profileData = await response.json();
      let achievementsData: Achievement[] = [];
      if (achievementsResponse?.ok) {
        const payload = await achievementsResponse.json();
        achievementsData = payload.achievements || [];
      }
      if (seq !== requestSeqRef.current) return; // stale response
      setProfile(profileData.profile);
      setAchievements(achievementsData);
      // Note: seasonHighlights and performances are fetched by API but not displayed yet
      // Can be added to UI in future: setSeasonHighlights(profileData.seasonHighlights || []);
      // Can be added to UI in future: setPerformances(profileData.performances || []);

      // Check privacy access via API
      const privacyResponse = await fetch(`/api/privacy/check?profileId=${athleteId}`);
      if (seq !== requestSeqRef.current) return; // stale response
      let canView = false;
      if (privacyResponse.ok) {
        const privacyCheck = await privacyResponse.json();
        canView = privacyCheck.canView;
        setHasAccess(canView);
      } else {
        // If privacy check fails, default to no access
        setHasAccess(false);
      }

      // Only load additional data if user has access
      if (canView) {
        // Load follow stats
        await loadFollowStats();
      }

    } catch (e) {
      if (seq !== requestSeqRef.current) return; // stale response
      console.error('Failed to load public athlete profile:', e);
      setError('Failed to load athlete profile');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }

  const loadFollowStats = async () => {
    try {
      const params = new URLSearchParams({ profileId: athleteId });
      if (user?.id) {
        params.append('currentUserId', user.id);
      }

      const response = await fetch(`/api/follow/stats?${params}`);
      
      if (response.ok) {
        const data = await response.json();
        setFollowStats(data);
      } else {
        console.error('Failed to load follow stats — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to load follow stats:', e);
    }
  };

  const handleFollowChange = (isFollowing: boolean, followersCount: number) => {
    setFollowStats(prev => ({
      ...prev,
      isFollowing,
      followersCount
    }));
  };

  // Show loading state
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600 mx-auto"></div>
          <p className="mt-2 text-gray-900 font-medium">Loading athlete profile...</p>
        </div>
      </div>
    );
  }

  // Show private profile view if access is denied
  if (!hasAccess && profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader showSearch={false} />
        <PrivateProfileView
          profile={profile}
          onFollow={(isFollowing) => {
            if (isFollowing) {
              // Refresh profile to check if access granted
              loadAthleteProfile();
            }
          }}
        />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-500 mb-4">
            <i className="fas fa-exclamation-triangle text-4xl"></i>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{error}</h1>
          <p className="text-gray-900 font-medium mb-4">
            {error === 'Athlete not found'
              ? 'This athlete profile could not be found or may not be public.'
              : 'There was an error loading the athlete profile.'}
          </p>
          <div className="space-x-4">
            <button
              onClick={() => router.push('/feed')}
              className="bg-violet-600 text-white px-6 py-2 rounded-lg hover:bg-violet-700 transition-colors"
            >
              Back to Feed
            </button>
            <button
              onClick={loadAthleteProfile}
              className="bg-gray-200 text-gray-900 font-semibold px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  // Check if viewing own profile
  const isOwnProfile = user?.id === athleteId;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Unified Header */}
      <AppHeader showSearch={true} />

      {/* Profile Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Page Header with Back Button and Actions */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
          {/* flex-wrap: back + title + FollowButton is wider than a 320px
              screen; the button drops to its own line instead of overflowing. */}
          <div className="flex flex-wrap items-center justify-between gap-y-2 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => router.back()}
                className="ea-icon-btn inline-flex items-center justify-center -ml-2 text-gray-700 hover:text-gray-900"
                aria-label="Go back"
              >
                <i className="fas fa-arrow-left text-xl"></i>
              </button>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {isOwnProfile ? 'My Profile' : 'Athlete Profile'}
              </h2>
            </div>

            {!isOwnProfile && (
              <div className="flex items-center gap-3">
                <FollowButton
                  profileId={athleteId}
                  currentUserId={user?.id}
                  onFollowChange={handleFollowChange}
                  size="md"
                />
              </div>
            )}
          </div>
        </div>

        {/* Profile Info Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6 overflow-hidden">
          {/* Cover photo (3:1; gradient until the athlete sets one) */}
          {profile.cover_url ? (
            // The 3:1 ratio moves to this wrapper so <Image fill> has a
            // positioned parent to fill; the gradient branch keeps it inline.
            <div className="relative w-full aspect-[3/1] max-h-64">
              <Image
                src={profile.cover_url}
                alt=""
                fill
                preload
                sizes="(max-width: 1280px) 100vw, 1232px"
                className="object-cover"
                unoptimized={!isOptimizableImageSrc(profile.cover_url)}
              />
            </div>
          ) : (
            <div
              className="w-full aspect-[3/1] max-h-64 bg-gradient-to-r from-violet-600 via-violet-500 to-purple-500"
              aria-hidden="true"
            />
          )}
          <div className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 lg:gap-8">
          {/* Profile Image with Score Badge */}
          <div className="relative flex-shrink-0">
            {profile.avatar_url ? (
              <LazyImage
                src={profile.avatar_url}
                alt="Profile Picture"
                className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full object-cover border-4 border-violet-500"
                width={192}
                height={192}
              />
            ) : (
              <div className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full bg-violet-500 border-4 border-violet-500 flex items-center justify-center text-white text-4xl sm:text-5xl font-bold">
                {getInitials(formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name))}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 w-full">
            <div className="mb-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-black break-words min-w-0">
                  {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
                </h1>
                {getHandle(profile) && (
                  <span className="text-lg text-gray-500">{getHandle(profile)}</span>
                )}
              </div>

              {/* Top achievements — same source as the Achievements tab */}
              {achievements.length > 0 && (
                <div className="mt-2">
                  <AchievementPills pills={topPills(achievements, 4)} />
                </div>
              )}
            </div>
            
            {profile.bio && (
              <p className="text-black font-semibold text-lg mb-6">
                {profile.bio}
              </p>
            )}

            {/* Follow stats + social links — socials are outbound links here
                (the owner's page keeps click-to-edit instead) */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="flex flex-wrap items-center gap-4 sm:gap-8">
                <button
                  onClick={() => {
                    setFollowersModalTab('following');
                    setIsFollowersModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-gray-900 font-bold hover:text-violet-600 transition-colors"
                >
                  <span className="font-bold">{followStats.followingCount}</span>
                  <span>Fan Of</span>
                </button>
                <button
                  onClick={() => {
                    setFollowersModalTab('followers');
                    setIsFollowersModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-gray-900 font-bold hover:text-violet-600 transition-colors"
                >
                  <span className="font-bold">{followStats.followersCount}</span>
                  <span>Fans</span>
                </button>

                {/* Social links */}
                {profile.social_twitter && (
                  <a
                    href={`https://x.com/${formatSocialHandle(profile.social_twitter)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)} on X`}
                    className="flex items-center gap-2 text-gray-900 font-bold hover:text-violet-600 transition-colors"
                  >
                    <i className="fa-brands fa-x-twitter text-2xl" aria-hidden="true"></i>
                    <span>{formatSocialHandleDisplay(profile.social_twitter)}</span>
                  </a>
                )}
                {profile.social_instagram && (
                  <a
                    href={`https://instagram.com/${formatSocialHandle(profile.social_instagram)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)} on Instagram`}
                    className="flex items-center gap-2 text-gray-900 font-bold hover:text-violet-600 transition-colors"
                  >
                    <i className="fa-brands fa-instagram text-2xl text-pink-600" aria-hidden="true"></i>
                    <span>{formatSocialHandleDisplay(profile.social_instagram)}</span>
                  </a>
                )}
                {profile.social_facebook && (
                  <a
                    href={`https://facebook.com/${formatSocialHandle(profile.social_facebook)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)} on Facebook`}
                    className="flex items-center gap-2 text-gray-900 font-bold hover:text-violet-600 transition-colors"
                  >
                    <i className="fa-brands fa-facebook text-2xl text-violet-600" aria-hidden="true"></i>
                    <span>{formatSocialHandleDisplay(profile.social_facebook)}</span>
                  </a>
                )}
              </div>
            </div>

          </div>
          </div>
        </div>
        </div>

      {/* Media Section with Segmented Tabs (scroll-mt clears sticky header) */}
      <div id="media-section" className="bg-white rounded-lg shadow-md p-4 sm:p-6 scroll-mt-20">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-black">Athletic Profile & Media</h2>
        </div>

        <FeaturedPosts
          profileId={athleteId}
          isOwnProfile={isOwnProfile}
          currentUserId={user?.id}
        />
        <ProfileMediaTabs
          profileId={athleteId}
          currentUserId={user?.id}
          isOwnProfile={isOwnProfile}
        />
      </div>
      </div>

      {/* Toast Container */}

      {/* Shared-post deep link (?post=) AND sport-card latest-post opens —
          one modal serves both; the replaceState below is a no-op for card
          clicks (no ?post= in the URL then) */}
      <PostDetailModal
        postId={deepLinkPostId}
        isOpen={!!deepLinkPostId}
        onClose={() => {
          setDeepLinkPostId(null);
          // Drop the ?post= param without a full navigation
          window.history.replaceState(null, '', `/athlete/${athleteId}`);
        }}
        currentUserId={user?.id}
      />

      {/* Followers/Following Modal */}
      <FollowersModal
        isOpen={isFollowersModalOpen}
        onClose={() => setIsFollowersModalOpen(false)}
        profileId={athleteId}
        initialTab={followersModalTab}
      />
    </div>
  );
}