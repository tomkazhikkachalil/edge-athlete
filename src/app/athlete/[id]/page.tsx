'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import LazyImage from '@/components/LazyImage';
import AppHeader from '@/components/AppHeader';
import FollowButton from '@/components/FollowButton';
import PrivateProfileView from '@/components/PrivateProfileView';
import ProfileMediaTabs, { type SportSpotlight } from '@/components/ProfileMediaTabs';
import type { SportKey } from '@/lib/sports';
import FeaturedPosts from '@/components/FeaturedPosts';
import MultiSportHighlights from '@/components/MultiSportHighlights';
import PostDetailModal from '@/components/PostDetailModal';
import FollowersModal from '@/components/FollowersModal';
import type { Profile, AthleteBadge } from '@/lib/supabase';
// Privacy checks moved to API route
import {
  formatHeight,
  formatAge,
  formatDisplayName,
  getInitials,
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

  useEffect(() => {
    const postParam = searchParams.get('post');
    if (postParam) setDeepLinkPostId(postParam);
  }, [searchParams]);

  // Sport Highlights card click → filter media + open the sport's latest
  // post (reuses the deep-link modal below; privacy is server-side in
  // /api/posts, so a visitor never gets a modal for a post they can't see).
  const [sportSpotlight, setSportSpotlight] = useState<SportSpotlight | null>(null);
  const spotlightSeqRef = useRef(0);
  const handleSportClick = useCallback(async (sportKey: SportKey, year: number | null) => {
    setSportSpotlight({ sportKey, year, ts: Date.now() });
    document.getElementById('media-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const seq = ++spotlightSeqRef.current;
    try {
      const res = await fetch(
        `/api/posts?userId=${athleteId}&sportKey=${sportKey}&limit=1`,
        { credentials: 'include' }
      );
      if (!res.ok || seq !== spotlightSeqRef.current) return;
      const data = await res.json();
      const id = data.posts?.[0]?.id;
      if (id && seq === spotlightSeqRef.current) setDeepLinkPostId(id);
    } catch { /* scroll + filter already happened */ }
  }, [athleteId]);

  // Profile data
  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<AthleteBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postsCount, setPostsCount] = useState(0);
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

  const loadAthleteProfile = async () => {
    const seq = ++requestSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      // Load profile data
      const response = await fetch(`/api/profile?id=${athleteId}`);
      if (seq !== requestSeqRef.current) return; // stale response
      if (!response.ok) {
        if (response.status === 404) {
          setError('Athlete not found');
          return;
        }
        throw new Error('Failed to load profile');
      }

      const profileData = await response.json();
      if (seq !== requestSeqRef.current) return; // stale response
      setProfile(profileData.profile);
      setBadges(profileData.badges || []);
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
  };

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

  // Badge color mapping helper (currently unused but kept for future feature)
  // const getBadgeColor = (colorToken: string) => {
  //   const colorMap: Record<string, string> = {
  //     'blue': 'border-blue-200 bg-blue-50 text-blue-700',
  //     'green': 'border-green-200 bg-green-50 text-green-700',
  //     'yellow': 'border-yellow-200 bg-yellow-50 text-yellow-700',
  //     'red': 'border-red-200 bg-red-50 text-red-700',
  //     'purple': 'border-purple-200 bg-purple-50 text-purple-700',
  //     'gray': 'border-gray-200 bg-gray-50 text-gray-700',
  //   };
  //   return colorMap[colorToken] || colorMap['gray'];
  // };

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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-900 font-medium">Loading athlete profile...</p>
        </div>
      </div>
    );
  }

  // Show private profile view if access is denied
  if (!hasAccess && profile) {
    return (
      <div className="min-h-screen bg-gray-50">
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
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
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
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="text-gray-700 hover:text-gray-900 transition-colors"
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 lg:gap-8">
          {/* Profile Image with Score Badge */}
          <div className="relative flex-shrink-0">
            {profile.avatar_url ? (
              <LazyImage
                src={profile.avatar_url}
                alt="Profile Picture"
                className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full object-cover border-4 border-blue-500"
                width={192}
                height={192}
              />
            ) : (
              <div className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full bg-blue-500 border-4 border-blue-500 flex items-center justify-center text-white text-4xl sm:text-5xl font-bold">
                {getInitials(formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name))}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 w-full">
            <div className="mb-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-black">
                  {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
                </h1>
                {getHandle(profile) && (
                  <span className="text-lg text-gray-500">{getHandle(profile)}</span>
                )}
              </div>

              {/* Badges */}
              {badges.length > 0 && (
                <div className="flex gap-3 mt-2 flex-wrap">
                  {badges.slice(0, 2).map((badge, index) => (
                    <div
                      key={badge.id}
                      className={`${index === 0 ? 'bg-gradient-to-r from-blue-600 to-blue-700' : 'bg-gradient-to-r from-purple-600 to-purple-700'} text-white px-4 py-1.5 rounded-full font-semibold flex items-center`}
                    >
                      {badge.icon_url && (
                        <LazyImage
                          src={badge.icon_url}
                          alt={`${badge.label} logo`}
                          className="w-5 h-5 mr-2"
                          width={20}
                          height={20}
                        />
                      )}
                      {badge.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {profile.bio && (
              <p className="text-black font-semibold text-lg mb-6">
                {profile.bio}
              </p>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 sm:gap-6 p-4 bg-gray-50 rounded-xl mb-6">
              <div className="text-center">
                <p className="font-bold text-gray-900">Height</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.height_cm ? formatHeight(profile.height_cm) : '--'}
                </p>
              </div>
              <div className="text-center md:border-l">
                <p className="font-bold text-gray-900">Weight</p>
                <p className="font-bold text-xl text-black mt-1">
                  {/* weight_display is already in the display unit — do NOT run
                      it through formatWeightWithUnit (which expects kg and
                      converts; 150 lbs was rendering as "331 lbs") */}
                  {profile.weight_display && profile.weight_unit
                    ? `${profile.weight_display} ${profile.weight_unit}`
                    : '--'}
                </p>
              </div>
              <div className="text-center md:border-l">
                <p className="font-bold text-gray-900">Age</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.dob ? formatAge(profile.dob) : '--'}
                </p>
              </div>
              <div className="text-center md:border-l">
                <p className="font-bold text-gray-900">Location</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.location || '--'}
                </p>
              </div>
              <div className="text-center md:border-l">
                <p className="font-bold text-gray-900">Posts</p>
                <p className="font-bold text-xl text-black mt-1">{postsCount}</p>
              </div>
            </div>

            {/* Social Links & Follow Stats */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="flex flex-wrap items-center gap-4 sm:gap-8">
                <button
                  onClick={() => {
                    setFollowersModalTab('following');
                    setIsFollowersModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-gray-900 font-bold hover:text-blue-600 transition-colors"
                >
                  <span className="font-bold">{followStats.followingCount}</span>
                  <span>Fan Of</span>
                </button>
                <button
                  onClick={() => {
                    setFollowersModalTab('followers');
                    setIsFollowersModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-gray-900 font-bold hover:text-blue-600 transition-colors"
                >
                  <span className="font-bold">{followStats.followersCount}</span>
                  <span>Fans</span>
                </button>
                
                {/* Social Links */}
                {profile.social_twitter && (
                  <div className="flex items-center gap-3">
                    <i className="fa-brands fa-twitter text-2xl text-blue-500"></i>
                    <span className="text-gray-900 font-bold">
                      {formatSocialHandleDisplay(profile.social_twitter)}
                    </span>
                  </div>
                )}
                {profile.social_instagram && (
                  <div className="flex items-center gap-3">
                    <i className="fa-brands fa-instagram text-2xl text-pink-600"></i>
                    <span className="text-gray-900 font-bold">
                      {formatSocialHandleDisplay(profile.social_instagram)}
                    </span>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
        </div>

      {/* Sport Highlights — same live summary the owner sees; every data
          endpoint underneath privacy-gates by profileId server-side */}
      <div className="mb-8">
        <MultiSportHighlights profileId={athleteId} onSportClick={handleSportClick} />
      </div>

      {/* Media Section with Segmented Tabs (scroll-mt clears sticky header) */}
      <div id="media-section" className="bg-white rounded-lg shadow-md p-6 scroll-mt-20">
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
          onCountsChange={(counts) => setPostsCount(counts.all)}
          sportSpotlight={sportSpotlight}
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