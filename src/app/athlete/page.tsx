'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { AthleteService } from '@/lib/athleteService';
import EditProfileTabs from '@/components/EditProfileTabs';
import { ToastContainer, useToast } from '@/components/Toast';
import MultiSportHighlights from '@/components/MultiSportHighlights';
import SeasonHighlightsModal from '@/components/SeasonHighlightsModal';
import PerformanceModal from '@/components/PerformanceModal';
import LazyImage from '@/components/LazyImage';
import CreatePostModal from '@/components/CreatePostModal';
import RecentPosts from '@/components/RecentPosts';
import type { AthleteBadge, SeasonHighlight, Performance, Profile } from '@/lib/supabase';
import { 
  formatHeight, 
  formatWeightWithUnit, 
  formatAge, 
  formatDisplayName,
  getInitials,
  formatSocialHandleDisplay,
  validateHeight
} from '@/lib/formatters';
import { 
  PLACEHOLDERS,
  getPlaceholder
} from '@/lib/config';

export default function AthleteProfilePage() {
  const { user, profile, loading, signOut, refreshProfile, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [badges, setBadges] = useState<AthleteBadge[]>([]);
  const [highlights, setHighlights] = useState<SeasonHighlight[]>([]);
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  
  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSeasonHighlightsModalOpen, setIsSeasonHighlightsModalOpen] = useState(false);
  const [editingSportKey, setEditingSportKey] = useState<string>('');
  const [editingHighlight, setEditingHighlight] = useState<SeasonHighlight | undefined>();
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false);
  const [editingPerformance, setEditingPerformance] = useState<Performance | undefined>();
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [submitStates, setSubmitStates] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toasts, dismissToast, showSuccess, showError } = useToast();
  
  // Create Post Modal state
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);

  // Posts count for stats display
  const [postsCount, setPostsCount] = useState(0);

  // Posts refresh key - increment to force RecentPosts to reload
  const [postsRefreshKey, setPostsRefreshKey] = useState(0);

  // Follow stats
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

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

  // Load athlete data
  useEffect(() => {
    if (user?.id) {
      loadAthleteData(user.id);
      loadFollowStats(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAthleteData = async (profileId: string, skipLoadingState = false) => {
    try {
      if (!skipLoadingState) {
        setDataLoading(true);
      }

      // Use Promise.allSettled for better error handling and faster responses
      const [badgesResult, highlightsResult, performancesResult] = await Promise.allSettled([
        AthleteService.getBadges(profileId),
        AthleteService.getSeasonHighlights(profileId),
        AthleteService.getRecentPerformances(profileId)
      ]);

      // Update each piece of data as it becomes available
      if (badgesResult.status === 'fulfilled') {
        setBadges(badgesResult.value);
      }
      if (highlightsResult.status === 'fulfilled') {
        setHighlights(highlightsResult.value);
        // Calculate athletic score based on highlights
        calculateAthleticScore(highlightsResult.value);
      }
      if (performancesResult.status === 'fulfilled') {
        setPerformances(performancesResult.value);
      }
    } catch (error) {
      console.error('Error loading athlete data:', error);
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
      }
    } catch (error) {
      console.error('Error loading follow stats:', error);
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

  // Helper functions for display
  const getBadgeColor = (colorToken: string): string => {
    const colors: Record<string, string> = {
      primary: 'bg-blue-100 text-blue-800 border-blue-200',
      purple: 'bg-purple-100 text-purple-800 border-purple-200',
      green: 'bg-green-100 text-green-800 border-green-200',
      red: 'bg-red-100 text-red-800 border-red-200',
      yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      gray: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    
    return colors[colorToken] || colors.primary;
  };

  // Prevent double submissions
  const withSubmitProtection = (key: string, fn: () => Promise<void>) => {
    return async () => {
      if (submitStates[key]) return; // Already submitting
      
      setSubmitStates(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: '' }));
      
      try {
        await fn();
      } catch (error) {
        setErrors(prev => ({ 
          ...prev, 
          [key]: error instanceof Error ? error.message : 'An error occurred'
        }));
      } finally {
        setSubmitStates(prev => ({ ...prev, [key]: false }));
      }
    };
  };


  const handleEditSeasonHighlights = (sportKey: string, entityId?: string) => {
    setEditingSportKey(sportKey);
    // entityId can be used to fetch existing data if needed
    setEditingHighlight(undefined);
    setIsSeasonHighlightsModalOpen(true);
  };

  const handleSaveSeasonHighlights = async (data: Partial<SeasonHighlight>) => {
    try {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const response = await fetch('/api/season-highlights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          highlightData: data,
          userId: user.id
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save season highlights');
      }

      // Show success toast
      showSuccess('Season highlights updated successfully!');

      // Refresh the data instead of full page reload - do it in background
      if (user?.id) {
        // Don't await - let it happen in background for faster UI response
        refreshProfile();
        loadAthleteData(user.id, true); // Skip loading state for background refresh
      }
    } catch (error) {
      // Season highlights save error
      showError('Failed to save season highlights', error instanceof Error ? error.message : 'Please try again');
      throw new Error(error instanceof Error ? error.message : 'Failed to save season highlights');
    }
  };

  const handleEditPerformance = (existingData?: Performance) => {
    setEditingPerformance(existingData);
    setIsPerformanceModalOpen(true);
  };

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
        
        // Also refresh performances specifically to maintain sort order
        AthleteService.getRecentPerformances(user.id).then(newPerformances => {
          setPerformances(newPerformances);
        }).catch((error) => {
          console.error('Failed to refresh performances:', error);
        });
      }
    } catch (error) {
      // Performance save error
      showError('Failed to save performance', error instanceof Error ? error.message : 'Please try again');
      throw new Error(error instanceof Error ? error.message : 'Failed to save performance');
    }
  };

  const handleDeletePerformance = async (performanceId: string) => {
    if (!window.confirm('Are you sure you want to delete this performance? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/performances/${performanceId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete performance');
      }

      // Show success toast
      showSuccess('Performance deleted successfully!');

      // Refresh the data
      if (user?.id) {
        refreshProfile();
        loadAthleteData(user.id, true);
        
        // Also refresh performances specifically to maintain sort order
        AthleteService.getRecentPerformances(user.id).then(newPerformances => {
          setPerformances(newPerformances);
        }).catch((error) => {
          console.error('Failed to refresh performances:', error);
        });
      }
    } catch (error) {
      // Performance delete error
      showError('Failed to delete performance', error instanceof Error ? error.message : 'Please try again');
    }
  };

  const handleAvatarUpload = withSubmitProtection('avatar-upload', async () => {
    const fileInput = document.getElementById('avatar-upload') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    
    if (!file) return;

    // File validation
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    
    if (file.size > maxSize) {
      throw new Error('File size must be less than 5MB');
    }
    
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Please select a valid image file (JPG, PNG, GIF, or WebP)');
    }

    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    setAvatarUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      formData.append('userId', user.id);

      const response = await fetch('/api/upload/avatar', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload avatar');
      }

      // Refresh the data to show the new avatar
      await Promise.all([
        refreshProfile(),
        user?.id ? loadAthleteData(user.id) : Promise.resolve()
      ]);
    } finally {
      setAvatarUploading(false);
      // Clear the file input
      if (fileInput) {
        fileInput.value = '';
      }
    }
  });

  // Inline editing functions
  const startEditing = (field: string, currentValue: string) => {
    setEditingField(field);
    
    // For height and weight fields, show user-friendly format for editing
    let editValue = currentValue;
    if (field === 'height_cm') {
      if (profile?.height_cm) {
        // Show formatted height for editing (e.g., "5'10")
        editValue = formatHeight(profile.height_cm);
      } else if (!currentValue || currentValue === PLACEHOLDERS.EMPTY_VALUE) {
        editValue = '';
      }
      // If currentValue is already a formatted height like "5'10"", use it as-is
      else if (currentValue && (currentValue.includes("'") || currentValue.includes("ft"))) {
        editValue = currentValue;
      }
    } else if (field === 'weight_display') {
      // For weight, show the current value with unit for editing
      if (profile?.weight_display) {
        editValue = `${profile.weight_display} ${profile.weight_unit || 'lbs'}`;
      } else if (!currentValue || currentValue === PLACEHOLDERS.EMPTY_VALUE || currentValue === 'Add weight') {
        editValue = '';
      } else {
        // Use the current formatted value as-is
        editValue = currentValue;
      }
    } else if (!currentValue || currentValue === PLACEHOLDERS.EMPTY_VALUE) {
      // If no value or placeholder, start with empty string
      editValue = '';
    }
    
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
    let newValue: string | number | null = tempValues[field];
    
    // Convert specific fields with proper parsing and validation
    if (field === 'height_cm') {
      const validation = validateHeight(newValue as string);
      if (validation.error) {
        throw new Error(validation.error);
      }
      newValue = validation.value || null;
    } else if (field === 'weight_display') {
      // Parse weight input - could be "150", "150 lbs", "68 kg", "11.7 stone"
      const input = (newValue as string).trim();
      const match = input.match(/^([\d.]+)\s*(lbs?|kg|stone)?$/i);
      
      if (!match) {
        throw new Error('Please enter a valid weight (e.g., "150", "150 lbs", "68 kg")');
      }
      
      const value = parseFloat(match[1]);
      const unit = (match[2]?.toLowerCase() || profile?.weight_unit || 'lbs') as 'lbs' | 'kg' | 'stone';
      
      if (isNaN(value) || value <= 0) {
        throw new Error('Please enter a valid weight value');
      }
      
      // Validate based on unit
      const maxWeight = unit === 'kg' ? 500 : unit === 'stone' ? 80 : 1100;
      if (value > maxWeight) {
        throw new Error(`Weight must be less than ${maxWeight} ${unit}`);
      }
      
      // Save both weight_display and weight_unit
      const updateData: Partial<Profile> = { 
        weight_display: value,
        weight_unit: unit
      };
      
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
      return; // Exit early since we handled the save
    } else if (field === 'class_year') {
      const numValue = parseFloat(newValue as string);
      newValue = isNaN(numValue) || numValue <= 0 ? null : numValue;
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

  // Inline editable component
  const InlineEdit = ({ 
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
  }) => {
    const isEditing = editingField === field;
    const displayValue = value || placeholder;
    const isSubmitting = submitStates['inline-edit'];
    const error = errors['inline-edit'];
    const isEmpty = !value;
    
    if (isEditing) {
      return (
        <>
          {/* Backdrop to capture clicks outside */}
          <div 
            className="fixed inset-0 z-40 bg-black bg-opacity-10" 
            onClick={cancelEditing}
            aria-hidden="true"
          />
          {/* Edit box positioned directly over the content */}
          <div className="absolute inset-0 z-50 flex items-center justify-center">
            <div className="bg-white border-2 border-blue-500 rounded-lg shadow-xl p-4 min-w-[300px]">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {multiline ? (
                  <textarea
                    value={tempValues[field] || ''}
                    onChange={(e) => setTempValues({ ...tempValues, [field]: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none min-h-[44px]"
                    rows={3}
                    autoFocus
                    aria-label={ariaLabel || `Edit ${field}`}
                    disabled={isSubmitting}
                  />
                ) : (
                  <input
                    type={inputType}
                    value={tempValues[field] || ''}
                    onChange={(e) => setTempValues({ ...tempValues, [field]: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[44px]"
                    autoFocus
                    aria-label={ariaLabel || `Edit ${field}`}
                    disabled={isSubmitting}
                  />
                )}
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
                <button
                  onClick={cancelEditing}
                  disabled={isSubmitting}
                  className="min-w-[44px] min-h-[44px] px-3 py-2 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="Cancel editing"
                >
                  ✕
                </button>
              </div>
              {error && (
                <div className="text-red-600 text-sm px-2" role="alert">
                  {error}
                </div>
              )}
            </div>
            </div>
          </div>
        </>
      );
    }

    return (
      <div className="relative">
        <button
          type="button"
          className={`cursor-pointer hover:bg-blue-50 hover:outline hover:outline-2 hover:outline-blue-300 rounded-md px-2 py-1 min-h-[44px] text-left w-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${className} ${
            isEmpty ? 'text-gray-500 italic' : ''
          }`}
          onClick={() => startEditing(field, value)}
          aria-label={ariaLabel || `Edit ${field}: ${displayValue}`}
        >
          {displayValue}
        </button>
      </div>
    );
  };

  // Show loading state during initial auth resolution
  if (loading || !initialAuthCheckComplete) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Authenticating...</p>
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-6">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Athletic Profile</h1>
              <nav className="hidden md:flex items-center gap-6">
                <button
                  onClick={() => router.push('/feed')}
                  className="text-gray-700 hover:text-gray-900 font-medium"
                >
                  Feed
                </button>
                <button
                  onClick={() => router.push('/athlete')}
                  className="text-blue-600 hover:text-blue-700 font-medium border-b-2 border-blue-600"
                >
                  Profile
                </button>
              </nav>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={() => setIsCreatePostModalOpen(true)}
                className="bg-blue-600 text-white px-3 py-2 sm:px-4 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-xs sm:text-sm font-medium"
                aria-label="Create new post"
              >
                <i className="fas fa-plus"></i>
                <span className="hidden sm:inline">Create Post</span>
                <span className="sm:hidden">Post</span>
              </button>
              <button
                onClick={() => router.push('/feed')}
                className="bg-gray-600 text-white px-3 py-2 sm:px-4 rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2 text-xs sm:text-sm font-medium"
                aria-label="View community feed"
              >
                <i className="fas fa-stream"></i>
                Feed
              </button>
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="bg-green-600 text-white px-3 py-2 sm:px-4 rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 text-xs sm:text-sm font-medium"
                aria-label="Edit athlete profile"
              >
                <i className="fas fa-edit"></i>
                <span className="hidden sm:inline">Edit Profile</span>
                <span className="sm:hidden">Edit</span>
              </button>
              <button
                onClick={() => signOut()}
                className="bg-red-600 text-white px-3 py-2 sm:px-4 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 text-xs sm:text-sm font-medium"
                aria-label="Sign out of account"
              >
                <i className="fas fa-sign-out-alt"></i>
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Profile Header Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-8">
          <div className="p-8">
            <div className="flex items-start gap-8">
              {/* Profile Picture with Rating */}
              <div className="relative flex-shrink-0">
                <LazyImage
                  src={profile?.avatar_url}
                  alt={`${formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)} avatar`}
                  className="w-48 h-48 rounded-full object-cover border-4 border-white shadow-lg"
                  width={192}
                  height={192}
                  priority
                  fallback={
                    <div 
                      className="w-48 h-48 rounded-full bg-gray-200 flex items-center justify-center border-4 border-white shadow-lg"
                      role="img"
                      aria-label={`${formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)} avatar`}
                    >
                      <span className="text-gray-600 font-semibold text-5xl" aria-hidden="true">
                        {getInitials(formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name))}
                      </span>
                    </div>
                  }
                />
                
                {/* Rating Bubble */}
                {athleticScore > 0 && (
                  <div
                    className="absolute -top-2 -right-2 bg-blue-600 text-white text-lg font-bold px-3 py-2 rounded-full border-4 border-white shadow-lg"
                    role="img"
                    aria-label="Athlete rating"
                  >
                    {athleticScore}
                  </div>
                )}
                
                {/* Avatar Upload Button */}
                <div className="absolute -bottom-2 -right-2">
                  <label
                    htmlFor="avatar-upload"
                    className={`w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                      avatarUploading ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    aria-label={avatarUploading ? 'Uploading avatar...' : 'Upload new avatar'}
                    tabIndex={0}
                  >
                    {avatarUploading ? (
                      <div 
                        className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"
                        aria-hidden="true"
                      ></div>
                    ) : (
                      <i className="fas fa-camera text-white" aria-hidden="true"></i>
                    )}
                  </label>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={() => handleAvatarUpload()}
                    disabled={avatarUploading}
                    aria-describedby="avatar-help"
                  />
                  <div id="avatar-help" className="sr-only">
                    Upload a new profile picture. Supported formats: JPG, PNG, GIF. Maximum size: 5MB.
                  </div>
                </div>
              </div>
              
              {/* Profile Information */}
              <div className="flex-1 min-w-0">
                <div className="mb-6">
                  <InlineEdit
                    field="full_name"
                    value={formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)}
                    placeholder="Click to add your name"
                    className="text-4xl font-bold text-gray-900 mb-2 block"
                    ariaLabel="Athlete name"
                  />
                  
                  {/* Badges Row */}
                  <div className="flex flex-wrap gap-2 mb-4" role="list" aria-label="Athlete badges">
                    {badges.length > 0 ? (
                      badges.slice(0, 4).map((badge: AthleteBadge) => (
                        <div
                          key={badge.id}
                          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getBadgeColor(badge.color_token)}`}
                          role="listitem"
                          aria-label={`Badge: ${badge.label}`}
                        >
                          {badge.icon_url && (
                            <LazyImage
                              src={badge.icon_url}
                              alt={`${badge.label} badge icon`}
                              className="w-4 h-4 mr-2"
                              width={16}
                              height={16}
                            />
                          )}
                          <span>{badge.label}</span>
                        </div>
                      ))
                    ) : (
                      <div 
                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-500 border border-gray-200"
                        role="listitem"
                        aria-label="No badges earned yet"
                      >
                        {getPlaceholder('NO_ACHIEVEMENTS')}
                      </div>
                    )}
                  </div>

                  {/* Sport and Team Info */}
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-4">
                    {profile?.sport && (
                      <div>
                        <span className="font-medium text-gray-900">Sport:</span>
                        <span className="ml-1">{profile.sport}</span>
                      </div>
                    )}
                    {(profile?.school || profile?.team) && (
                      <div>
                        <span className="font-medium text-gray-900">Team:</span>
                        <span className="ml-1">{[profile?.school, profile?.team].filter(Boolean).join(' • ')}</span>
                      </div>
                    )}
                    {profile?.position && (
                      <div>
                        <span className="font-medium text-gray-900">Position:</span>
                        <span className="ml-1">{profile.position}</span>
                      </div>
                    )}
                    {profile?.class_year && (
                      <div>
                        <span className="font-medium text-gray-900">Class:</span>
                        <span className="ml-1">{profile.class_year}</span>
                      </div>
                    )}
                  </div>

                  {/* Biography */}
                  <InlineEdit
                    field="bio"
                    value={profile?.bio || ''}
                    placeholder={getPlaceholder('ADD_BIO')}
                    className="text-gray-700 leading-relaxed mb-4 block"
                    multiline={true}
                    ariaLabel="Athlete biography"
                  />
                  
                  {/* Stats Row */}
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex items-center gap-1 text-gray-600">
                      <span className="font-semibold text-gray-900">{followingCount}</span>
                      <span>Following</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-600">
                      <span className="font-semibold text-gray-900">{followersCount}</span>
                      <span>Followers</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-600">
                      <span className="font-semibold text-gray-900">{postsCount}</span>
                      <span>Posts</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Vitals Section */}
          <div className="border-t border-gray-200 bg-gray-50 px-8 py-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Vitals</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
              <div className="text-center bg-white rounded-lg border border-gray-200 p-4">
                <InlineEdit
                  field="height_cm"
                  value={formatHeight(profile?.height_cm)}
                  placeholder={getPlaceholder('NO_HEIGHT')}
                  className="text-2xl font-bold text-gray-900 block mb-1"
                  ariaLabel="Height in feet and inches"
                  inputType="text"
                />
                <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Height</div>
              </div>
              <div className="text-center bg-white rounded-lg border border-gray-200 p-4">
                <InlineEdit
                  field="weight_display"
                  value={(() => {
                    if (profile?.weight_display && profile?.weight_unit) {
                      return `${profile.weight_display} ${profile.weight_unit}`;
                    }
                    const formatted = formatWeightWithUnit(profile?.weight_kg, profile?.weight_unit);
                    return formatted;
                  })()}
                  placeholder={getPlaceholder('NO_WEIGHT')}
                  className="text-2xl font-bold text-gray-900 block mb-1"
                  ariaLabel="Weight"
                  inputType="text"
                />
                <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Weight</div>
              </div>
              <div className="text-center bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900 mb-1">
                  {formatAge(profile?.dob) || '--'}
                </div>
                <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Age</div>
              </div>
              <div className="text-center bg-white rounded-lg border border-gray-200 p-4">
                <InlineEdit
                  field="location"
                  value={profile?.location || ''}
                  placeholder={getPlaceholder('NO_LOCATION')}
                  className="text-2xl font-bold text-gray-900 block mb-1"
                  ariaLabel="Location"
                />
                <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Location</div>
              </div>
              <div className="text-center bg-white rounded-lg border border-gray-200 p-4">
                <InlineEdit
                  field="class_year"
                  value={profile?.class_year ? String(profile.class_year) : ''}
                  placeholder={getPlaceholder('NO_CLASS_YEAR')}
                  className="text-2xl font-bold text-gray-900 block mb-1"
                  inputType="number"
                  ariaLabel="Class year"
                />
                <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Class Year</div>
              </div>
            </div>
          </div>
          
          {/* Social Media Section */}
          <div className="border-t border-gray-200 px-8 py-4">
            <div className="flex items-center justify-center gap-6" role="list" aria-label="Social media links">
              <div className="flex items-center gap-2" role="listitem">
                <i className="fab fa-twitter text-blue-400 text-lg" aria-label="Twitter" aria-hidden="true"></i>
                <InlineEdit
                  field="social_twitter"
                  value={formatSocialHandleDisplay(profile?.social_twitter)}
                  placeholder={getPlaceholder('ADD_TWITTER')}
                  className="text-sm text-gray-600"
                  ariaLabel="Twitter handle"
                />
              </div>
              <div className="flex items-center gap-2" role="listitem">
                <i className="fab fa-instagram text-pink-500 text-lg" aria-label="Instagram" aria-hidden="true"></i>
                <InlineEdit
                  field="social_instagram"
                  value={formatSocialHandleDisplay(profile?.social_instagram)}
                  placeholder={getPlaceholder('ADD_INSTAGRAM')}
                  className="text-sm text-gray-600"
                  ariaLabel="Instagram handle"
                />
              </div>
              <div className="flex items-center gap-2" role="listitem">
                <i className="fab fa-facebook text-blue-600 text-lg" aria-label="Facebook" aria-hidden="true"></i>
                <InlineEdit
                  field="social_facebook"
                  value={formatSocialHandleDisplay(profile?.social_facebook)}
                  placeholder="Add Facebook"
                  className="text-sm text-gray-600"
                  ariaLabel="Facebook handle"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="space-y-8">
          {/* Season Highlights */}
          <MultiSportHighlights
            profileId={user?.id || ''}
            canEdit={true}
            onEdit={handleEditSeasonHighlights}
          />

          {/* Posts Feed */}
          <RecentPosts
            key={postsRefreshKey}
            profileId={user?.id || ''}
            currentUserId={user?.id}
            showCreateButton={true}
            onCreatePost={() => setIsCreatePostModalOpen(true)}
            onPostsLoad={(count) => setPostsCount(count)}
          />
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        profile={profile}
        badges={badges}
        highlights={highlights}
        performances={performances}
        onSave={async () => {
          // Refresh all data after save
          await Promise.all([
            refreshProfile(),
            user?.id ? loadAthleteData(user.id) : Promise.resolve()
          ]);
        }}
      />
      
      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Season Highlights Modal */}
      <SeasonHighlightsModal
        isOpen={isSeasonHighlightsModalOpen}
        onClose={() => setIsSeasonHighlightsModalOpen(false)}
        sportKey={editingSportKey}
        existingData={editingHighlight}
        onSave={handleSaveSeasonHighlights}
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
        onPostCreated={(post) => {
          console.log('Post created, refreshing feed...', post);
          // Force RecentPosts to reload by changing its key
          setPostsRefreshKey(prev => prev + 1);
          // Refresh athlete data
          if (user?.id) {
            loadAthleteData(user.id, true);
          }
        }}
      />
    </div>
  );
}