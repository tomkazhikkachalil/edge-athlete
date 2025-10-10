'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, useParams } from 'next/navigation';
import { ToastContainer, useToast } from '@/components/Toast';
import LazyImage from '@/components/LazyImage';
import FollowButton from '@/components/FollowButton';
import PrivateProfileView from '@/components/PrivateProfileView';
import ProfileMediaTabs from '@/components/ProfileMediaTabs';
import FollowersModal from '@/components/FollowersModal';
import type { Profile, AthleteBadge } from '@/lib/supabase';
// Privacy checks moved to API route
import {
  formatHeight,
  formatWeightWithUnit,
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
  const athleteId = params.id as string;
  
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

  const { toasts, dismissToast } = useToast();

  // Note: seasonHighlights and performances are fetched but not currently displayed
  // These can be added to the UI in future updates

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  // Load athlete profile data
  useEffect(() => {
    if (athleteId && user) {
      loadAthleteProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, user]);

  const loadAthleteProfile = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load profile data
      const response = await fetch(`/api/profile?id=${athleteId}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Athlete not found');
          return;
        }
        throw new Error('Failed to load profile');
      }

      const profileData = await response.json();
      setProfile(profileData.profile);
      setBadges(profileData.badges || []);
      // Note: seasonHighlights and performances are fetched by API but not displayed yet
      // Can be added to UI in future: setSeasonHighlights(profileData.seasonHighlights || []);
      // Can be added to UI in future: setPerformances(profileData.performances || []);

      // Check privacy access via API
      const privacyResponse = await fetch(`/api/privacy/check?profileId=${athleteId}`);
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

    } catch (err) {
      console.error('Error loading athlete profile:', err);
      setError('Failed to load athlete profile');
    } finally {
      setLoading(false);
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
      }
    } catch (err) {
      // Silently handle errors for follow stats
      console.error('Error loading follow stats:', err);
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
    <div className="min-h-screen bg-gray-100 p-8">
      {/* Header Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="text-gray-900 hover:text-black transition-colors"
            >
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h2 className="text-2xl font-bold text-gray-900">Athlete Profile</h2>
          </div>
          
          <div className="flex items-center gap-3">
            {!isOwnProfile && (
              <>
                <button
                  onClick={() => router.push('/feed')}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-medium h-10"
                >
                  <i className="fas fa-stream"></i>
                  Feed
                </button>
                <FollowButton
                  profileId={athleteId}
                  currentUserId={user?.id}
                  onFollowChange={handleFollowChange}
                  size="md"
                />
              </>
            )}
            {isOwnProfile && (
              <>
                <button
                  onClick={() => router.push('/athlete')}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 text-sm font-medium h-10"
                >
                  <i className="fas fa-plus"></i>
                  Create Post
                </button>
                <button
                  onClick={() => router.push('/feed')}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-medium h-10"
                >
                  <i className="fas fa-stream"></i>
                  Feed
                </button>
                <button
                  onClick={() => router.push('/athlete')}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 text-sm font-medium h-10"
                >
                  <i className="fa-solid fa-edit"></i>
                  Edit Profile
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-8">
          {/* Profile Image with Score Badge */}
          <div className="relative">
            {profile.avatar_url ? (
              <LazyImage
                src={profile.avatar_url}
                alt="Profile Picture"
                className="w-48 h-48 rounded-full object-cover border-4 border-blue-500"
                width={192}
                height={192}
              />
            ) : (
              <div className="w-48 h-48 rounded-full bg-blue-500 border-4 border-blue-500 flex items-center justify-center text-white text-5xl font-bold">
                {getInitials(formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name))}
              </div>
            )}
            <div className="absolute -bottom-2 -right-2 bg-green-500 text-white rounded-full w-14 h-14 flex items-center justify-center font-bold text-2xl">
              85
            </div>
          </div>

          <div className="flex-1">
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-3xl font-bold text-black">
                  {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
                </h1>
                {getHandle(profile) && (
                  <span className="text-lg text-gray-500">{getHandle(profile)}</span>
                )}
              </div>

              {/* Badges */}
              <div className="flex gap-3 mt-2">
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
                {badges.length === 0 && (
                  <>
                    <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-1.5 rounded-full font-semibold">
                      Athlete
                    </div>
                    <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white px-4 py-1.5 rounded-full font-semibold">
                      Elite
                    </div>
                  </>
                )}
              </div>
            </div>
            
            <p className="text-black font-semibold text-lg mb-6">
              {profile.bio || 'Elite Multi-sport Athlete'}
            </p>

            {/* Stats Grid */}
            <div className="grid grid-cols-5 gap-6 p-4 bg-gray-50 rounded-xl mb-6">
              <div className="text-center">
                <p className="font-bold text-gray-900">Height</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.height_cm ? formatHeight(profile.height_cm) : '--'}
                </p>
              </div>
              <div className="text-center border-l">
                <p className="font-bold text-gray-900">Weight</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.weight_display && profile.weight_unit
                    ? formatWeightWithUnit(profile.weight_display, profile.weight_unit)
                    : '--'}
                </p>
              </div>
              <div className="text-center border-l">
                <p className="font-bold text-gray-900">Age</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.dob ? formatAge(profile.dob) : '--'}
                </p>
              </div>
              <div className="text-center border-l">
                <p className="font-bold text-gray-900">Location</p>
                <p className="font-bold text-xl text-black mt-1">
                  {profile.location || '--'}
                </p>
              </div>
              <div className="text-center border-l">
                <p className="font-bold text-gray-900">Posts</p>
                <p className="font-bold text-xl text-black mt-1">{postsCount}</p>
              </div>
            </div>

            {/* Social Links & Follow Stats */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-8">
                <button
                  onClick={() => {
                    setFollowersModalTab('following');
                    setIsFollowersModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-gray-900 font-bold hover:text-blue-600 transition-colors"
                >
                  <span className="font-bold">{followStats.followingCount}</span>
                  <span>Following</span>
                </button>
                <button
                  onClick={() => {
                    setFollowersModalTab('followers');
                    setIsFollowersModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-gray-900 font-bold hover:text-blue-600 transition-colors"
                >
                  <span className="font-bold">{followStats.followersCount}</span>
                  <span>Followers</span>
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

            {/* Sports Achievements Grid */}
            <div className="grid grid-cols-4 gap-6">
              {/* Sport-specific achievement cards will be populated based on profile.sport */}
              <div className="bg-blue-50 rounded-xl p-5 border-2 border-blue-100 min-h-[160px] flex flex-col">
                <div className="flex items-center mb-4">
                  <i className="fa-solid fa-trophy text-blue-600 text-2xl mr-2"></i>
                  <span className="font-bold text-blue-800 text-lg">
                    {profile.sport || 'Primary Sport'}
                  </span>
                </div>
                <div className="flex-1 flex items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-200 rounded-full flex items-center justify-center">
                      <i className="fa-solid fa-medal text-blue-600"></i>
                    </div>
                    <div>
                      <p className="font-semibold text-black">Elite Level</p>
                      <p className="text-sm text-black font-semibold">{profile.position || 'Position'}</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-purple-50 rounded-xl p-5 border-2 border-purple-100 min-h-[160px] flex flex-col">
                <div className="flex items-center mb-4">
                  <i className="fa-solid fa-star text-purple-600 text-2xl mr-2"></i>
                  <span className="font-bold text-purple-800 text-lg">Achievements</span>
                </div>
                <div className="flex-1 flex items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-purple-200 rounded-full flex items-center justify-center">
                      <i className="fa-solid fa-trophy text-purple-600"></i>
                    </div>
                    <div>
                      <p className="font-semibold text-black">{badges.length} Badges</p>
                      <p className="text-sm text-black font-semibold">Earned</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-green-50 rounded-xl p-5 border-2 border-green-100 min-h-[160px] flex flex-col">
                <div className="flex items-center mb-4">
                  <i className="fa-solid fa-chart-line text-green-600 text-2xl mr-2"></i>
                  <span className="font-bold text-green-800 text-lg">Performance</span>
                </div>
                <div className="flex-1 flex items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-200 rounded-full flex items-center justify-center">
                      <i className="fa-solid fa-trending-up text-green-600"></i>
                    </div>
                    <div>
                      <p className="font-semibold text-black">Trending Up</p>
                      <p className="text-sm text-black font-semibold">Season Stats</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 rounded-xl p-5 border-2 border-yellow-100 min-h-[160px] flex flex-col">
                <div className="flex items-center mb-4">
                  <i className="fa-solid fa-star text-yellow-500 text-2xl mr-2"></i>
                  <span className="font-bold text-yellow-800 text-lg">Elite Status</span>
                </div>
                <div className="flex-1 flex flex-col justify-center space-y-2">
                  <div className="flex items-center gap-3">
                    <i className="fa-solid fa-ranking-star text-yellow-500 text-lg"></i>
                    <p className="font-semibold text-sm text-black">Top Performer</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <i className="fa-solid fa-medal text-yellow-500 text-lg"></i>
                    <p className="font-semibold text-sm text-black">Multi-sport Excellence</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <i className="fa-solid fa-trophy text-yellow-500 text-lg"></i>
                    <p className="font-semibold text-sm text-black">Championship Level</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Season Highlights */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <h2 className="text-xl font-bold text-black mb-4">2024-25 Season Highlights</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-trophy text-blue-600 text-lg"></i>
                <h3 className="text-base font-bold text-blue-800">
                  {profile.sport || 'Primary Sport'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Elite</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Performance</p>
                <p className="text-xl font-bold text-blue-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Achievements</p>
                <p className="text-xl font-bold text-blue-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Games</p>
                <p className="text-xl font-bold text-blue-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Rating</p>
                <p className="text-xl font-bold text-blue-700">85</p>
              </div>
            </div>
          </div>

          <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-medal text-purple-600 text-lg"></i>
                <h3 className="text-base font-bold text-purple-800">Secondary</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded-full">Active</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Stats</p>
                <p className="text-xl font-bold text-purple-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Records</p>
                <p className="text-xl font-bold text-purple-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Events</p>
                <p className="text-xl font-bold text-purple-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Rating</p>
                <p className="text-xl font-bold text-purple-700">--</p>
              </div>
            </div>
          </div>

          <div className="bg-green-50 rounded-xl p-3 border border-green-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-running text-green-600 text-lg"></i>
                <h3 className="text-base font-bold text-green-800">Fitness</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full">Training</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Endurance</p>
                <p className="text-xl font-bold text-green-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Strength</p>
                <p className="text-xl font-bold text-green-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Speed</p>
                <p className="text-xl font-bold text-green-700">--</p>
              </div>
              <div className="bg-white rounded-lg p-2 text-center">
                <p className="text-xs text-gray-900 font-bold">Overall</p>
                <p className="text-xl font-bold text-green-700">--</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Media Section with Segmented Tabs */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-black">Athletic Profile & Media</h2>
        </div>

        <ProfileMediaTabs
          profileId={athleteId}
          currentUserId={user?.id}
          isOwnProfile={isOwnProfile}
          onCountsChange={(counts) => setPostsCount(counts.all)}
        />
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

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