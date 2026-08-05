'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import LazyImage from '@/components/LazyImage';
import SportSettingsRow from '@/components/SportSettingsRow';
import AchievementPills from '@/components/achievements/AchievementPills';
import { topPills } from '@/lib/achievements/display';
import type { SettingsDisplayItem } from '@/lib/sports/settings-schemas';
import {
  formatHeight,
  formatWeightWithUnit,
  formatAge,
  formatDisplayName,
  getInitials
} from '@/lib/formatters';
import { MapPin, School, Users, Calendar, Trophy, Lock } from 'lucide-react';

interface PublicProfile {
  id: string;
  handle: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  sport: string | null;
  position: string | null;
  school: string | null;
  team: string | null;
  location: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_unit: string | null;
  dob: string | null;
  class_year: number | null;
  social_twitter: string | null;
  social_instagram: string | null;
  /** Optional so cached responses from before this field existed parse. */
  social_facebook?: string | null;
  visibility: string;
  created_at: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

interface PostMedia {
  id: string;
  media_url: string;
  type: string;
}

interface RecentPost {
  id: string;
  caption: string;
  sport_key: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  post_media: PostMedia[];
}

interface SportStats {
  label: string;
  tiles: Array<{ label: string; value: string }>;
}

interface ProfileData {
  profile: PublicProfile;
  recentPosts: RecentPost[];
  /** Real athlete_achievements rows (pill fields only). Optional so a
   *  cached response from before this field existed still parses. */
  achievements?: Array<{
    id: string;
    title: string;
    placement: string | null;
    achieved_on: string;
  }>;
  sportStats: SportStats | null;
  /** Declared per-sport details. Already filtered server-side, so a sport
   *  with nothing to show is simply absent. Optional so a cached client
   *  response from before this field existed still parses. */
  sportSettings?: Array<{
    sportKey: string;
    sportLabel: string;
    items: SettingsDisplayItem[];
  }>;
}

export default function PublicProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const username = params.username as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [privateProfileId, setPrivateProfileId] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);

  useEffect(() => {
    // cancelled guard: navigating /u/a -> /u/b keeps this component mounted;
    // a slow response for the previous handle must not overwrite the new one
    let cancelled = false;
    const loadPublicProfile = async () => {
      if (!username) return;

      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/public/profile?handle=${encodeURIComponent(username)}`);
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          if (response.status === 404) {
            setError('Profile not found');
          } else if (response.status === 403 && data.isPrivate) {
            setIsPrivate(true);
            setPrivateProfileId(data.profileId || null);
          } else {
            setError(data.error || 'Failed to load profile');
          }
          return;
        }

        setProfileData(data);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load public profile:', e);
        setError('Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPublicProfile();
    return () => { cancelled = true; };
  }, [username]);

  // Redirect logged-in users viewing their own profile
  useEffect(() => {
    if (user && profileData?.profile?.id === user.id) {
      router.push('/athlete');
    }
  }, [user, profileData, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600 mx-auto"></div>
            <p className="mt-3 text-gray-600">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Profile Not Found</h1>
            <p className="text-gray-600 mb-6">
              The profile @{username} does not exist.
            </p>
            <Link
              href="/"
              className="inline-flex items-center px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isPrivate) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-gray-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Private Profile</h1>
            <p className="text-gray-600 mb-6">
              @{username} has a private profile. Become a fan to see their content.
            </p>
            {user && privateProfileId ? (
              <Link
                href={`/athlete/${privateProfileId}`}
                className="inline-flex items-center px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
              >
                Become a Fan
              </Link>
            ) : (
              <Link
                href="/"
                className="inline-flex items-center px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
              >
                Sign In to Become a Fan
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!profileData) return null;

  const { profile, recentPosts, sportStats } = profileData;
  // Defaults so a response predating these fields renders normally.
  const sportSettings = profileData.sportSettings ?? [];
  const achievements = profileData.achievements ?? [];
  const displayName = formatDisplayName(profile.first_name, profile.middle_name, profile.last_name, profile.full_name);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Profile Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Cover area */}
          <div className="h-24 sm:h-32 bg-gradient-to-r from-violet-500 to-violet-600" />

          {/* Profile info */}
          <div className="px-4 sm:px-6 pb-6">
            {/* Avatar */}
            <div className="-mt-12 sm:-mt-16 mb-4">
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white bg-white shadow-md overflow-hidden">
                {profile.avatar_url ? (
                  <LazyImage
                    src={profile.avatar_url}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center">
                    <span className="text-2xl sm:text-3xl font-bold text-white">
                      {getInitials(displayName)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Name and Handle */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 break-words">{displayName}</h1>
                <p className="text-gray-500">@{profile.handle}</p>

                {/* Bio */}
                {profile.bio && (
                  <p className="mt-3 text-gray-700 max-w-xl">{profile.bio}</p>
                )}

                {/* Meta info */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-600">
                  {profile.sport && (
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="w-4 h-4" />
                      {profile.sport}
                      {profile.position && ` - ${profile.position}`}
                    </span>
                  )}
                  {profile.school && (
                    <span className="inline-flex items-center gap-1">
                      <School className="w-4 h-4" />
                      {profile.school}
                    </span>
                  )}
                  {profile.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {profile.location}
                    </span>
                  )}
                  {profile.class_year && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Class of {profile.class_year}
                    </span>
                  )}
                </div>

                {/* Physical stats */}
                {(profile.height_cm || profile.weight_kg) && (
                  <div className="mt-2 flex gap-3 text-sm text-gray-600">
                    {profile.height_cm && (
                      <span>{formatHeight(profile.height_cm)}</span>
                    )}
                    {profile.weight_kg && (
                      <span>{formatWeightWithUnit(profile.weight_kg, profile.weight_unit as 'lbs' | 'kg' | 'stone' | null)}</span>
                    )}
                    {profile.dob && (
                      <span>{formatAge(profile.dob)}</span>
                    )}
                  </div>
                )}

                {/* Social links */}
                <div className="mt-3 flex gap-3">
                  {profile.social_instagram && (
                    <a
                      href={`https://instagram.com/${profile.social_instagram.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-pink-500 transition-colors"
                      aria-label={`${displayName} on Instagram`}
                    >
                      <i className="fab fa-instagram text-xl" aria-hidden="true"></i>
                    </a>
                  )}
                  {profile.social_twitter && (
                    <a
                      href={`https://x.com/${profile.social_twitter.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-gray-900 transition-colors"
                      aria-label={`${displayName} on X`}
                    >
                      <i className="fa-brands fa-x-twitter text-xl" aria-hidden="true"></i>
                    </a>
                  )}
                  {profile.social_facebook && (
                    <a
                      href={`https://facebook.com/${profile.social_facebook.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-violet-600 transition-colors"
                      aria-label={`${displayName} on Facebook`}
                    >
                      <i className="fab fa-facebook text-xl" aria-hidden="true"></i>
                    </a>
                  )}
                </div>
              </div>

              {/* Stats and CTA */}
              <div className="flex flex-col items-start sm:items-end gap-3">
                {/* Fan stats */}
                <div className="flex gap-6 text-sm">
                  <div className="text-center">
                    <span className="block font-bold text-gray-900">{profile.postsCount}</span>
                    <span className="text-gray-500">Posts</span>
                  </div>
                  <div className="text-center">
                    <span className="block font-bold text-gray-900">{profile.followersCount}</span>
                    <span className="text-gray-500">Fans</span>
                  </div>
                  <div className="text-center">
                    <span className="block font-bold text-gray-900">{profile.followingCount}</span>
                    <span className="text-gray-500">Fan Of</span>
                  </div>
                </div>

                {/* CTA */}
                {user ? (
                  <Link
                    href={`/athlete/${profile.id}`}
                    className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
                  >
                    View Full Profile
                  </Link>
                ) : (
                  <Link
                    href="/"
                    className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
                  >
                    Sign In to Connect
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Achievements — real athlete_achievements rows, podium-first */}
        {achievements.length > 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Achievements</h2>
            <AchievementPills pills={topPills(achievements, 8)} />
          </div>
        )}

        {/* Sport Stats — sport-aware (golf, ice hockey, volleyball, …) */}
        {sportStats && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{sportStats.label}</h2>
            {/* 2-up below sm: three ~85px columns wrapped labels like
                "Greens in Reg" to three lines and collided the values. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {sportStats.tiles.map(tile => (
                <div key={tile.label} className="text-center">
                  <span className="block text-2xl font-bold text-gray-900">{tile.value}</span>
                  <span className="text-xs text-gray-500">{tile.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Declared per-sport details. Same card shell as Sport Stats above so
            the two surfaces cannot drift apart. */}
        {sportSettings.length > 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
            {sportSettings.map(group => (
              <div key={group.sportKey}>
                <h2 className="text-sm font-semibold text-gray-700 mb-1">{group.sportLabel}</h2>
                <SportSettingsRow items={group.items} className="border-t-0 px-0 py-0" />
              </div>
            ))}
          </div>
        )}

        {/* Recent Posts */}
        {recentPosts.length > 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Posts</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {recentPosts.map((post) => (
                <div
                  key={post.id}
                  className="aspect-square rounded-lg overflow-hidden bg-gray-100 relative group"
                >
                  {post.post_media && post.post_media[0] ? (
                    <LazyImage
                      src={post.post_media[0].media_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-3">
                      <p className="text-xs text-gray-500 text-center line-clamp-4">
                        {post.caption || 'No content'}
                      </p>
                    </div>
                  )}
                  {/* Overlay with stats */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white text-sm">
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
                      </svg>
                      {post.likes_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                      </svg>
                      {post.comments_count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {user && (
              <div className="mt-4 text-center">
                <Link
                  href={`/athlete/${profile.id}`}
                  className="text-sm text-violet-600 hover:text-violet-700 font-medium"
                >
                  View All Posts
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Empty state for no posts */}
        {recentPosts.length === 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No public posts yet</p>
          </div>
        )}

        {/* Sign up CTA for logged out users */}
        {!user && (
          <div className="mt-6 bg-gradient-to-r from-violet-600 to-violet-700 rounded-xl p-6 text-center text-white">
            <h3 className="text-lg font-semibold mb-2">Join Edge Athlete</h3>
            <p className="text-violet-100 mb-4">
              Create your athlete profile and connect with {displayName}
            </p>
            <Link
              href="/"
              className="inline-flex items-center px-6 py-2 bg-white text-violet-600 rounded-lg hover:bg-violet-50 transition-colors font-medium"
            >
              Get Started
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
