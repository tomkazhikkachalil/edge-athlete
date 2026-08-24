'use client';

import { useEffect, useState, createContext, useContext } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { AthleteService } from '@/lib/athleteService';
import { useToast } from '@/components/Toast';
import LazyImage from '@/components/LazyImage';
import ProfileMediaTabs from '@/components/ProfileMediaTabs';
import FeaturedPosts from '@/components/FeaturedPosts';
import StatementsRail from '@/components/StatementsRail';
import SportQuickLinks from '@/components/SportQuickLinks';
import AvatarUploader from '@/components/AvatarUploader';
import CoverPhotoUploader from '@/components/CoverPhotoUploader';
import PostDetailModal from '@/components/PostDetailModal';
import { resolveSportKey, isComposerSport } from '@/lib/sports/resolve-sport-key';
import AppHeader from '@/components/AppHeader';

// Heavy / rarely-open modals — split into their own chunks. Cuts First Load
// JS on /athlete (~257 kB → lighter, modals fetch on open).
const EditProfileTabs = dynamic(() => import('@/components/EditProfileTabs'), { ssr: false });
const CreatePostModal = dynamic(() => import('@/components/CreatePostModal'), { ssr: false });
const PerformanceModal = dynamic(() => import('@/components/PerformanceModal'), { ssr: false });
const FollowersModal = dynamic(() => import('@/components/FollowersModal'), { ssr: false });
import type { SeasonHighlight, Performance, Profile } from '@/lib/supabase';
import AchievementPills from '@/components/achievements/AchievementPills';
import OrgMembershipsStrip from '@/components/affiliations/OrgMembershipsStrip';
import { topPills } from '@/lib/achievements/display';
import type { Achievement } from '@/lib/achievements';
import {
  formatDisplayName,
  getInitials,
  formatSocialHandleDisplay,
} from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';
import { 
  PLACEHOLDERS,
  getPlaceholder
} from '@/lib/config';


// ── InlineEdit: module-scope so its component identity is STABLE across the
// page's renders. When it was defined inside AthleteProfilePage, every
// keystroke created a new function identity → React unmounted/remounted the
// whole edit popup → the caret jumped to the end (and IME input broke).
// Shared page state flows in via context.
interface InlineEditContextValue {
  editingField: string | null;
  tempValues: Record<string, string>;
  setTempValue: (field: string, value: string) => void;
  isSubmitting: boolean;
  error: string | undefined;
  startEditing: (field: string, value: string) => void;
  cancelEditing: () => void;
  saveInlineEdit: () => void;
}
const InlineEditContext = createContext<InlineEditContextValue | null>(null);

function InlineEdit({
  field,
  value,
  placeholder,
  className = "",
  multiline = false,
  inputType = "text",
  ariaLabel
}: {
  field: string;
  value: string;
  placeholder: string;
  className?: string;
  multiline?: boolean;
  inputType?: string;
  ariaLabel?: string;
}) {
  const ctx = useContext(InlineEditContext);
  if (!ctx) return null;
  const { editingField, tempValues, setTempValue, isSubmitting, error, startEditing, cancelEditing, saveInlineEdit } = ctx;

  const isEditing = editingField === field;
  const displayValue = value || placeholder;
  const isEmpty = !value;

  if (isEditing) {
    return (
      <div className="relative">
        {/* Invisible copy of the display content keeps the field's footprint,
            so the sm:absolute popup anchors to the FIELD (a positioned
            ancestor) instead of resolving against the document top. */}
        <div className={`px-2 py-1 min-h-[44px] invisible ${className}`} aria-hidden="true">
          {displayValue}
        </div>
        {/* Backdrop to capture clicks outside */}
        <div
          className="fixed inset-0 z-40 bg-black/10"
          onClick={cancelEditing}
          aria-hidden="true"
        />
        {/* Edit box: viewport-centered on mobile, anchored to the field on sm+ */}
        <div className="fixed sm:absolute inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
          {/* Stacked layout: full-width input on top, ✓/✕ in their own row
              below. The old side-by-side row overflowed the bordered box on
              narrow screens (input's intrinsic min-width + two 44px buttons
              exceeded the max-w cap, so the buttons rendered OUTSIDE the
              bubble) — and would have floated mid-height beside a textarea. */}
          <div className="bg-surface border-2 border-violet-500 rounded-lg shadow-xl p-4 w-[min(320px,calc(100vw-2rem))]">
          <div className="flex flex-col gap-2">
            {multiline ? (
              <textarea
                value={tempValues[field] || ''}
                onChange={(e) => setTempValue(field, e.target.value)}
                className="w-full min-w-0 px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none min-h-[44px]"
                style={{ direction: 'ltr', unicodeBidi: 'normal' }}
                dir="ltr"
                rows={3}
                autoFocus
                aria-label={ariaLabel || `Edit ${field}`}
                disabled={isSubmitting}
              />
            ) : (
              <input
                type={inputType}
                value={tempValues[field] || ''}
                onChange={(e) => setTempValue(field, e.target.value)}
                className="w-full min-w-0 px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent min-h-[44px]"
                autoFocus
                aria-label={ariaLabel || `Edit ${field}`}
                disabled={isSubmitting}
              />
            )}
            {error && (
              <div className="text-red-600 dark:text-red-400 text-sm px-2" role="alert">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelEditing}
                disabled={isSubmitting}
                className="min-w-[44px] min-h-[44px] px-3 py-2 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Cancel editing"
              >
                ✕
              </button>
              <button
                onClick={saveInlineEdit}
                disabled={isSubmitting}
                className="min-w-[44px] min-h-[44px] px-3 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Save changes"
              >
                {isSubmitting ? (
                  <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                ) : (
                  '✓'
                )}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={`cursor-pointer hover:bg-brand-soft hover:outline hover:outline-2 hover:outline-violet-300 rounded-md px-2 py-1 min-h-[44px] text-left w-full focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors ${className} ${
          isEmpty ? 'text-muted italic' : ''
        }`}
        onClick={() => startEditing(field, value)}
        aria-label={ariaLabel || `Edit ${field}: ${displayValue}`}
      >
        {displayValue}
      </button>
    </div>
  );
}

export default function AthleteProfilePage() {
  const { user, profile, loading, refreshProfile, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  
  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false);
  const [editingPerformance] = useState<Performance | undefined>();
  const [submitStates, setSubmitStates] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showSuccess, showError } = useToast();
  
  // Create Post Modal state
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);

  // Posts count for stats display
  const [postsCount, setPostsCount] = useState(0);
  // counts.all is media-only since migration 074; statements feed the rail.
  const [statementsCount, setStatementsCount] = useState(0);

  // Media refresh trigger
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  // ?post= deep link target (own-profile share links).
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  // Follow stats
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // Followers Modal state
  const [isFollowersModalOpen, setIsFollowersModalOpen] = useState(false);
  const [followersModalTab, setFollowersModalTab] = useState<'followers' | 'following'>('followers');

  // Athletic score calculation
  const [athleticScore, setAthleticScore] = useState<number>(0);

  // Inline editing states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [tempValues, setTempValues] = useState<Record<string, string>>({});

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // ?post= deep link (own-profile share links; also preserved through the
  // /athlete/[id] self-redirect). Mount-only window.location read — same
  // pattern as the feed's ?create=1, avoids useSearchParams' Suspense
  // requirement on this statically prerendered page.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('post');
    if (p) setOpenPostId(p);
  }, []);

  // Load athlete data
  useEffect(() => {
    if (user?.id) {
      // Load critical data immediately
      loadAthleteData(user.id);

      // PERFORMANCE FIX: Defer follow stats to avoid blocking page render
      // Use requestIdleCallback for better performance
      const idleCallback = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
      idleCallback(() => {
        loadFollowStats(user.id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAthleteData = async (profileId: string, skipLoadingState = false) => {
    try {
      if (!skipLoadingState) {
        setDataLoading(true);
      }

      // Use Promise.allSettled for better error handling and faster responses
      const [achievementsResult, highlightsResult] = await Promise.allSettled([
        fetch(`/api/achievements?profileId=${profileId}`, { credentials: 'include' })
          .then(res => (res.ok ? res.json() : { achievements: [] }))
          .then(data => (data.achievements || []) as Achievement[]),
        AthleteService.getSeasonHighlights(profileId)
      ]);

      // Update each piece of data as it becomes available
      if (achievementsResult.status === 'fulfilled') {
        setAchievements(achievementsResult.value);
      }
      if (highlightsResult.status === 'fulfilled') {
        // Calculate athletic score based on highlights
        calculateAthleticScore(highlightsResult.value);
      }
    } catch (e) {
      console.error('Failed to load athlete profile data:', e);
      showError('Failed to load profile data', 'Some information may not be displayed correctly.');
    } finally {
      if (!skipLoadingState) {
        setDataLoading(false);
      }
    }
  };

  const loadFollowStats = async (profileId: string) => {
    try {
      const response = await fetch(`/api/follow/stats?profileId=${profileId}`);
      if (response.ok) {
        const data = await response.json();
        setFollowersCount(data.followersCount || 0);
        setFollowingCount(data.followingCount || 0);
      } else {
        console.error('Failed to load follow stats — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to load follow stats:', e);
      setFollowersCount(0);
      setFollowingCount(0);
    }
  };

  const calculateAthleticScore = (highlights: SeasonHighlight[]) => {
    // Calculate score based on available data
    // This is a simple algorithm that can be refined based on sport-specific metrics
    let score = 50; // Base score

    if (highlights && highlights.length > 0) {
      // Add points for having highlights
      score += Math.min(highlights.length * 5, 20);

      // Add points based on ratings in highlights
      const avgRating = highlights.reduce((sum, h) => sum + (h.rating || 0), 0) / highlights.length;
      if (avgRating > 0) {
        score = Math.min(Math.round(avgRating), 100);
      }
    }

    // Add points for profile completeness
    if (profile?.bio) score += 5;
    if (profile?.avatar_url) score += 5;
    if (profile?.location) score += 3;
    if (profile?.height_cm) score += 2;
    if (profile?.weight_display) score += 2;

    // Add points for social engagement
    if (followersCount > 0) score += Math.min(Math.floor(followersCount / 10), 10);
    if (postsCount > 0) score += Math.min(Math.floor(postsCount / 5), 8);

    // Cap at 100
    setAthleticScore(Math.min(score, 100));
  };

  // Prevent double submissions
  const withSubmitProtection = (key: string, fn: () => Promise<void>) => {
    return async () => {
      if (submitStates[key]) return; // Already submitting
      
      setSubmitStates(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: '' }));
      
      try {
        await fn();
      } catch (err) {
        setErrors(prev => ({
          ...prev,
          [key]: err instanceof Error ? err.message : 'An error occurred'
        }));
      } finally {
        setSubmitStates(prev => ({ ...prev, [key]: false }));
      }
    };
  };


  // Performance editing temporarily disabled - keeping handlers for future use
  // const handleEditPerformance = (existingData?: Performance) => {
  //   setEditingPerformance(existingData);
  //   setIsPerformanceModalOpen(true);
  // };

  const handleSavePerformance = async (data: Partial<Performance>) => {
    try {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const response = await fetch('/api/performances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          performanceData: data,
          userId: user.id
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save performance');
      }

      // Show success toast  
      showSuccess(editingPerformance ? 'Performance updated successfully!' : 'Performance added successfully!');

      // Refresh the data instead of full page reload - do it in background  
      if (user?.id) {
        // Don't await - let it happen in background for faster UI response
        refreshProfile();
        loadAthleteData(user.id, true); // Skip loading state for background refresh
      }
    } catch (err) {
      // Performance save error
      const message = err instanceof Error ? err.message : 'Failed to save performance';
      showError('Failed to save performance', message);
      throw new Error(message);
    }
  };

  // Performance deletion temporarily disabled - keeping handler for future use
  // const handleDeletePerformance = async (performanceId: string) => {
  //   if (!window.confirm('Are you sure you want to delete this performance? This action cannot be undone.')) {
  //     return;
  //   }

  //   try {
  //     const response = await fetch(`/api/performances/${performanceId}`, {
  //       method: 'DELETE',
  //     });

  //     if (!response.ok) {
  //       const error = await response.json();
  //       throw new Error(error.error || 'Failed to delete performance');
  //     }

  //     // Show success toast
  //     showSuccess('Performance deleted successfully!');

  //     // Refresh the data
  //     if (user?.id) {
  //       refreshProfile();
  //       loadAthleteData(user.id, true);

  //       // Also refresh performances specifically to maintain sort order
  //       AthleteService.getRecentPerformances(user.id).then(newPerformances => {
  //         setPerformances(newPerformances);
  //       }).catch((error) => {
  //         
  //       });
  //     }
  //   } catch {
  //     // Performance delete error
  //     showError('Failed to delete performance', error instanceof Error ? error.message : 'Please try again');
  //   }
  // };

  // Avatar picking/cropping/uploading lives in the shared AvatarUploader
  // (circle crop via the media editor); this just refreshes on success.
  const handleAvatarUploaded = async () => {
    await Promise.all([
      refreshProfile(),
      user?.id ? loadAthleteData(user.id) : Promise.resolve(),
    ]);
  };

  // Inline editing functions. Only the socials use InlineEdit since the
  // header Vitals strip was removed (Aug 2026) — height/weight/location/
  // class-year edit through Edit Profile → Vitals now.
  const startEditing = (field: string, currentValue: string) => {
    setEditingField(field);
    const editValue =
      !currentValue || currentValue === PLACEHOLDERS.EMPTY_VALUE ? '' : currentValue;
    setTempValues({ [field]: editValue });
  };

  const cancelEditing = () => {
    setEditingField(null);
    setTempValues({});
  };

  const saveInlineEdit = withSubmitProtection('inline-edit', async () => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    const field = editingField!;
    const newValue: string | number | null = tempValues[field];

    if (field === 'full_name') {
      // Split full_name into first_name and last_name
      const fullNameTrimmed = (newValue as string).trim();
      let firstName = '';
      let lastName = '';

      if (fullNameTrimmed) {
        const nameParts = fullNameTrimmed.split(' ').filter(part => part.length > 0);
        if (nameParts.length === 1) {
          // Single name - treat as first name
          firstName = nameParts[0];
        } else if (nameParts.length >= 2) {
          // Multiple names - first word is first name, rest is last name
          firstName = nameParts[0];
          lastName = nameParts.slice(1).join(' ');
        }
      }

      // Cancel editing immediately for better UX
      cancelEditing();

      // Save all three name fields
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profileData: {
            full_name: fullNameTrimmed || null,
            first_name: firstName || null,
            last_name: lastName || null
          },
          userId: user.id
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save changes. Please try again.');
      }

      // Refresh the data to confirm the update
      await refreshProfile();
      return; // Exit early since we handled the save
    }

    const updateData: Partial<Profile> = { [field]: newValue };
    
    // Cancel editing immediately for better UX
    cancelEditing();

    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profileData: updateData,
        userId: user.id
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save changes. Please try again.');
    }

    // Refresh the data to confirm the update
    await refreshProfile();
  });

  // Show loading state during initial auth resolution
  if (loading || !initialAuthCheckComplete) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Checking your session...</p>
          <p className="mt-1 text-sm text-muted">This should only take a moment</p>
        </div>
      </div>
    );
  }

  // If no user after loading is complete, don't render anything (redirect will happen)
  if (!user) {
    return null;
  }

  // Show the UI even while data is loading - progressive loading approach
  // Only show skeleton if we have no profile data at all
  if (dataLoading && !profile) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Loading your profile...</p>
          <p className="mt-1 text-sm text-muted">Getting everything ready</p>
        </div>
      </div>
    );
  }

  return (
    <InlineEditContext.Provider value={{
      editingField,
      tempValues,
      setTempValue: (field, value) => setTempValues(prev => ({ ...prev, [field]: value })),
      isSubmitting: submitStates['inline-edit'],
      error: errors['inline-edit'],
      startEditing,
      cancelEditing,
      saveInlineEdit,
    }}>
    <div className="min-h-screen bg-canvas">
      {/* Unified Header */}
      <AppHeader
        showSearch={false}
        onCreatePost={() => setIsCreatePostModalOpen(true)}
        onEditProfile={() => setIsEditModalOpen(true)}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {/* Profile Header Section */}
        <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden mb-6 sm:mb-8">
          {/* Cover photo (3:1, cropped in the media editor; gradient until set) */}
          <div className="relative w-full aspect-[3/1] max-h-64">
            {profile?.cover_url ? (
              <Image
                src={profile.cover_url}
                alt="Profile cover"
                fill
                preload
                sizes="(max-width: 1280px) 100vw, 1232px"
                className="object-cover"
                unoptimized={!isOptimizableImageSrc(profile.cover_url)}
              />
            ) : (
              <div
                className="w-full h-full bg-gradient-to-r from-violet-600 via-violet-500 to-purple-500"
                aria-hidden="true"
              />
            )}
            <CoverPhotoUploader
              onUploaded={() => refreshProfile()}
              render={({ open, uploading }) => (
                <button
                  type="button"
                  onClick={open}
                  disabled={uploading}
                  aria-label={uploading ? 'Uploading cover photo…' : 'Change cover photo'}
                  className="absolute bottom-2 right-2 w-11 h-11 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center shadow-lg transition-colors disabled:opacity-50"
                >
                  {uploading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  ) : (
                    <i className="fas fa-camera" aria-hidden="true"></i>
                  )}
                </button>
              )}
            />
          </div>
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 lg:gap-8">
              {/* Profile Picture with Rating */}
              <div className="relative flex-shrink-0 mx-auto sm:mx-0">
                <LazyImage
                  src={profile?.avatar_url}
                  alt={`${formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)} avatar`}
                  className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full object-cover border-4 border-white shadow-lg"
                  width={192}
                  height={192}
                  priority
                  fallback={
                    <div
                      className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center border-4 border-white shadow-lg"
                      role="img"
                      aria-label={`${formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)} avatar`}
                    >
                      <span className="text-tertiary font-semibold text-3xl sm:text-4xl lg:text-5xl" aria-hidden="true">
                        {getInitials(formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name))}
                      </span>
                    </div>
                  }
                />
                
                {/* Rating Bubble */}
                {athleticScore > 0 && (
                  <div
                    className="absolute -top-2 -right-2 bg-brand text-white text-lg font-bold px-3 py-2 rounded-full border-4 border-white shadow-lg"
                    role="img"
                    aria-label="Athlete rating"
                  >
                    {athleticScore}
                  </div>
                )}
                
                {/* Avatar Upload Button */}
                <div className="absolute -bottom-2 -right-2">
                  <AvatarUploader
                    mode="immediate"
                    onUploaded={handleAvatarUploaded}
                    render={({ open, uploading }) => (
                      <button
                        type="button"
                        onClick={open}
                        disabled={uploading}
                        className={`w-14 h-14 bg-brand rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors ${
                          uploading ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        aria-label={uploading ? 'Uploading avatar...' : 'Upload new avatar'}
                      >
                        {uploading ? (
                          <div
                            className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"
                            aria-hidden="true"
                          ></div>
                        ) : (
                          <i className="fas fa-camera text-white" aria-hidden="true"></i>
                        )}
                      </button>
                    )}
                  />
                </div>
              </div>
              
              {/* Profile Information */}
              <div className="flex-1 min-w-0">
                <div className="mb-6">
                  <h1 className="text-3xl sm:text-4xl font-bold text-primary mb-2 break-words">
                    {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name) || 'Add your name in Edit Profile'}
                  </h1>
                  {profile && getHandle(profile) && (
                    <p className="text-xl text-muted mb-2">
                      {getHandle(profile)}
                    </p>
                  )}

                  {/* Top achievements — real athlete_achievements rows, the
                      same source as the Achievements tab (no fabricated
                      sample badges, ever) */}
                  <div className="mb-4">
                    <AchievementPills
                      pills={topPills(achievements, 4)}
                      emptyLabel={getPlaceholder('NO_ACHIEVEMENTS')}
                    />
                  </div>

                  {/* Sport and Team Info. Single column below sm — two ~110px
                      columns truncated nothing and just collided; truncate on
                      each cell keeps "school • team" to one tidy line. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-sm text-tertiary mb-4">
                    {profile?.sport && (
                      <div>
                        <span className="font-medium text-primary">Sport:</span>
                        <span className="ml-1">{profile.sport}</span>
                      </div>
                    )}
                    {(profile?.school || profile?.team) && (
                      <div className="min-w-0 truncate">
                        <span className="font-medium text-primary">Team:</span>
                        <span className="ml-1">{[profile?.school, profile?.team].filter(Boolean).join(' • ')}</span>
                      </div>
                    )}
                    {profile?.position && (
                      <div>
                        <span className="font-medium text-primary">Position:</span>
                        <span className="ml-1">{profile.position}</span>
                      </div>
                    )}
                    {profile?.class_year && (
                      <div>
                        <span className="font-medium text-primary">Class:</span>
                        <span className="ml-1">{profile.class_year}</span>
                      </div>
                    )}
                  </div>

                  {/* Clubs & Leagues memberships (org connections round) —
                      self-fetching, renders nothing when empty. */}
                  {profile?.id && (
                    <div className="mb-4">
                      <OrgMembershipsStrip profileId={profile.id} />
                    </div>
                  )}

                  {/* Quick links to the sport's dedicated pages (rounds,
                      trends) — adapter-declared, renders nothing for sports
                      without them. Own-profile only: these are YOUR stats. */}
                  {profile?.sport && (
                    <div className="mb-4">
                      <SportQuickLinks sport={profile.sport} />
                    </div>
                  )}

                  {/* Biography - View only, edit in modal */}
                  <div className="text-primary leading-relaxed mb-4 block">
                    {profile?.bio || (
                      <span className="text-primary italic">{getPlaceholder('ADD_BIO')}</span>
                    )}
                  </div>
                  
                  {/* Stats Row — Fans, Following, Posts (Tom's order) */}
                  <div className="flex items-center gap-6 text-sm">
                    <button
                      onClick={() => {
                        setFollowersModalTab('followers');
                        setIsFollowersModalOpen(true);
                      }}
                      className="flex items-center gap-1 text-tertiary hover:text-brand-fg transition-colors"
                    >
                      <span className="font-semibold text-primary">{followersCount}</span>
                      <span>Fans</span>
                    </button>
                    <button
                      onClick={() => {
                        setFollowersModalTab('following');
                        setIsFollowersModalOpen(true);
                      }}
                      className="flex items-center gap-1 text-tertiary hover:text-brand-fg transition-colors"
                    >
                      <span className="font-semibold text-primary">{followingCount}</span>
                      <span>Following</span>
                    </button>
                    <div className="flex items-center gap-1 text-tertiary">
                      <span className="font-semibold text-primary">{postsCount}</span>
                      <span>Posts</span>
                    </div>
                  </div>

                  {/* Social connections — directly under the profile info.
                      Click-to-edit is the affordance here; visitor + /u
                      surfaces render these as outbound links. */}
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6 mt-4" role="list" aria-label="Social media links">
                    <div className="flex items-center gap-2" role="listitem">
                      <i className="fa-brands fa-x-twitter text-primary text-lg" aria-hidden="true"></i>
                      <InlineEdit
                        field="social_twitter"
                        value={profile?.social_twitter ? formatSocialHandleDisplay(profile.social_twitter) : ''}
                        placeholder={getPlaceholder('ADD_TWITTER')}
                        className="text-sm text-tertiary"
                        ariaLabel="X handle"
                      />
                    </div>
                    <div className="flex items-center gap-2" role="listitem">
                      <i className="fab fa-instagram text-pink-500 text-lg" aria-hidden="true"></i>
                      <InlineEdit
                        field="social_instagram"
                        value={profile?.social_instagram ? formatSocialHandleDisplay(profile.social_instagram) : ''}
                        placeholder={getPlaceholder('ADD_INSTAGRAM')}
                        className="text-sm text-tertiary"
                        ariaLabel="Instagram handle"
                      />
                    </div>
                    <div className="flex items-center gap-2" role="listitem">
                      <i className="fa-brands fa-tiktok text-primary text-lg" aria-hidden="true"></i>
                      <InlineEdit
                        field="social_tiktok"
                        value={profile?.social_tiktok ? formatSocialHandleDisplay(profile.social_tiktok) : ''}
                        placeholder={getPlaceholder('ADD_TIKTOK')}
                        className="text-sm text-tertiary"
                        ariaLabel="TikTok handle"
                      />
                    </div>
                    <div className="flex items-center gap-2" role="listitem">
                      <i className="fab fa-facebook text-brand-fg text-lg" aria-hidden="true"></i>
                      <InlineEdit
                        field="social_facebook"
                        value={profile?.social_facebook ? formatSocialHandleDisplay(profile.social_facebook) : ''}
                        placeholder="Add Facebook"
                        className="text-sm text-tertiary"
                        ariaLabel="Facebook handle"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="space-y-8">
          {/* Media Tabs (scroll-mt clears the sticky AppHeader) */}
          <div id="media-section" className="bg-surface rounded-lg shadow-md p-4 sm:p-6 scroll-mt-20">
            {/* flex-wrap: title + Create Post is ~340px, over a 320px screen */}
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold text-black dark:text-primary">My Media</h2>
              <button
                onClick={() => setIsCreatePostModalOpen(true)}
                className="bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-hover transition-colors flex items-center gap-2"
              >
                <i className="fas fa-plus"></i>
                Create Post
              </button>
            </div>
            <FeaturedPosts
              profileId={user?.id || ''}
              isOwnProfile={true}
              currentUserId={user?.id}
              refreshKey={mediaRefreshKey}
            />
            <StatementsRail
              profileId={user?.id || ''}
              currentUserId={user?.id}
              totalCount={statementsCount}
              refreshKey={mediaRefreshKey}
            />
            <ProfileMediaTabs
              key={mediaRefreshKey}
              profileId={user?.id || ''}
              currentUserId={user?.id}
              isOwnProfile={true}
              onCountsChange={(counts) => {
                setPostsCount(counts.all);
                setStatementsCount(counts.statements ?? 0);
              }}
            />
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        profile={profile}
        onSave={async () => {
          // Refresh all data after save
          await Promise.all([
            refreshProfile(),
            user?.id ? loadAthleteData(user.id) : Promise.resolve()
          ]);
        }}
      />
      
      {/* Toast Container */}

      {/* One modal serves both the ?post= deep link and sport-card clicks */}
      <PostDetailModal
        postId={openPostId}
        isOpen={!!openPostId}
        onClose={() => {
          setOpenPostId(null);
          if (window.location.search.includes('post=')) {
            window.history.replaceState(null, '', '/athlete');
          }
        }}
        currentUserId={user?.id}
        // Without onDelete the owner's trash renders and silently no-ops.
        onDelete={async (postId) => {
          try {
            const response = await fetch(`/api/posts?postId=${postId}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || 'Failed to delete post');
            }
            setOpenPostId(null);
            if (window.location.search.includes('post=')) {
              window.history.replaceState(null, '', '/athlete');
            }
            if (user?.id) loadAthleteData(user.id, true);
            showSuccess('Success', 'Post deleted successfully');
          } catch (e) {
            console.error('Failed to delete post:', e);
            showError('Error', 'Failed to delete post');
          }
        }}
      />

      {/* Performance Modal */}
      <PerformanceModal
        isOpen={isPerformanceModalOpen}
        onClose={() => setIsPerformanceModalOpen(false)}
        existingData={editingPerformance}
        onSave={handleSavePerformance}
      />

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreatePostModalOpen}
        onClose={() => setIsCreatePostModalOpen(false)}
        userId={user?.id || ''}
        defaultSportKey={(() => {
          // Composer opens preset to the athlete's declared sport
          const key = resolveSportKey(profile?.sport);
          return isComposerSport(key) ? key : 'general';
        })()}
        onPostCreated={(newPost) => {
          // Refresh athlete data
          if (user?.id) {
            loadAthleteData(user.id, true);
          }
          // Trigger media refresh by changing the key
          setMediaRefreshKey(prev => prev + 1);
          setIsCreatePostModalOpen(false);
          // A golf round already showed its own "Round is LIVE!" toast, and
          // the composer is navigating into the round — a generic "Post
          // created successfully!" stacked on top of that is wrong.
          const isRound =
            !!newPost &&
            typeof newPost === 'object' &&
            (newPost as { type?: string }).type === 'golf_round';
          if (!isRound) showSuccess('Success', 'Post created successfully!');
        }}
      />

      {/* Followers/Following Modal */}
      <FollowersModal
        isOpen={isFollowersModalOpen}
        onClose={() => setIsFollowersModalOpen(false)}
        profileId={user?.id || ''}
        initialTab={followersModalTab}
      />
    </div>
    </InlineEditContext.Provider>
  );
}
