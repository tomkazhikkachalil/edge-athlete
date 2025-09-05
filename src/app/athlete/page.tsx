'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { AthleteService } from '@/lib/athleteService';
import EditProfileTabs from '@/components/EditProfileTabs';
import { ToastContainer, useToast } from '@/components/Toast';
import MultiSportHighlights from '@/components/MultiSportHighlights';
import MultiSportActivity from '@/components/MultiSportActivity';
import SeasonHighlightsModal from '@/components/SeasonHighlightsModal';
import PerformanceModal from '@/components/PerformanceModal';
import LazyImage from '@/components/LazyImage';
import CreatePostModal from '@/components/CreatePostModal';
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
    }
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
      }
      if (performancesResult.status === 'fulfilled') {
        setPerformances(performancesResult.value);
      }
    } catch {
      // Error loading athlete data
    } finally {
      if (!skipLoadingState) {
        setDataLoading(false);
      }
    }
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


  // Keeping this for backwards compatibility with any remaining references
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSaveProfile = async (updates: Partial<Profile>, badgeUpdates: AthleteBadge[]) => {
    try {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      
      const requestBody = {
        profileData: updates,
        userId: user.id
      };

      // Save profile updates
      const profileResponse = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      
      // Always try to get the response text first
      const responseText = await profileResponse.text();
      
      if (!profileResponse.ok) {
        console.error('Profile response not ok, status:', profileResponse.status);
        try {
          const error = responseText ? JSON.parse(responseText) : {};
          console.error('Profile save error response (parsed):', error);
          throw new Error(error.error || `HTTP ${profileResponse.status}: Failed to save profile`);
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          throw new Error(`HTTP ${profileResponse.status}: ${responseText || 'Failed to save profile'}`);
        }
      }

      try {
        if (responseText) JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse success response:', parseError);
      }

      // TODO: Implement badge updates API if needed
      if (badgeUpdates.length > 0) {
      }

      // Refresh the data instead of full page reload - do it in background
      if (user?.id) {
        // Don't await - let it happen in background for faster UI response
        refreshProfile();
        loadAthleteData(user.id, true); // Skip loading state for background refresh
      }
    } catch (error) {
      console.error('Profile save error:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to save profile changes');
    }
  };

  const handleEditSeasonHighlights = (sportKey: string, existingData?: SeasonHighlight) => {
    setEditingSportKey(sportKey);
    setEditingHighlight(existingData);
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
      console.error('Season highlights save error:', error);
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
        }).catch(error => {
          console.error('Failed to refresh performances:', error);
        });
      }
    } catch (error) {
      console.error('Performance save error:', error);
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
        }).catch(error => {
          console.error('Failed to refresh performances:', error);
        });
      }
    } catch (error) {
      console.error('Performance delete error:', error);
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
      {/* Debug Info - Remove after testing */}
      <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4 mx-4">
        <strong>Debug:</strong> Athlete Profile page loaded. 
        <br />User ID: {profile?.id || user?.id || 'No ID'} | Display Name: {formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)}
        <br />Email: {profile?.email || user?.email || 'No email'} | Auth User: {typeof signOut === 'function' ? 'Connected' : 'Not connected'}
        <br />Profile Data: first_name=&quot;{profile?.first_name || 'empty'}&quot;, last_name=&quot;{profile?.last_name || 'empty'}&quot;, full_name=&quot;{profile?.full_name || 'empty'}&quot;
        <br />Edit Modal: {isEditModalOpen ? 'Open' : 'Closed'} | Highlights Modal: {isSeasonHighlightsModalOpen ? 'Open' : 'Closed'}
      </div>
      
      {/* Header Section */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-section">
          
          {/* Avatar, Name, Rating Row */}
          <div className="flex items-start justify-between space-base">
            <div className="flex items-center gap-base">
              {/* Avatar with Rating Bubble */}
              <div className="relative">
                <LazyImage
                  src={profile?.avatar_url}
                  alt={`${formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)} avatar`}
                  className="w-20 h-20 rounded-full object-cover border-3 border-gray-300"
                  width={80}
                  height={80}
                  priority
                  fallback={
                    <div 
                      className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center border-3 border-gray-300"
                      role="img"
                      aria-label={`${formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)} avatar`}
                    >
                      <span className="text-gray-600 font-semibold text-xl" aria-hidden="true">
                        {getInitials(formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name))}
                      </span>
                    </div>
                  }
                />
                
                {/* Rating Bubble */}
                <div 
                  className="absolute -top-1 -right-1 bg-blue-500 text-white text-chip font-bold px-micro py-micro rounded-full border-2 border-white"
                  role="img"
                  aria-label="Athlete rating"
                >
                  {getPlaceholder('EMPTY_VALUE')}
                </div>
                
                {/* Avatar Upload Button */}
                <div className="absolute -bottom-1 -right-1">
                  <label
                    htmlFor="avatar-upload"
                    className={`min-w-[44px] min-h-[44px] w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                      avatarUploading ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    aria-label={avatarUploading ? 'Uploading avatar...' : 'Upload new avatar'}
                    tabIndex={0}
                  >
                    {avatarUploading ? (
                      <div 
                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                        aria-hidden="true"
                      ></div>
                    ) : (
                      <i className="fas fa-camera icon-footer text-white" aria-hidden="true"></i>
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
              
              {/* Name and Bio */}
              <div className="flex-1">
                <InlineEdit
                  field="full_name"
                  value={formatDisplayName(profile?.full_name, profile?.first_name, profile?.last_name)}
                  placeholder="Click to add your name"
                  className="text-h1 text-gray-900 space-micro block"
                  ariaLabel="Athlete name"
                />
                <InlineEdit
                  field="bio"
                  value={profile?.bio || ''}
                  placeholder={getPlaceholder('ADD_BIO')}
                  className="text-body text-gray-700 space-micro block"
                  multiline={true}
                  ariaLabel="Athlete biography"
                />
                
                {/* Top Badges */}
                <div className="flex flex-wrap gap-micro" role="list" aria-label="Athlete badges">
                  {badges.length > 0 ? (
                    badges.slice(0, 3).map((badge: AthleteBadge) => (
                      <div
                        key={badge.id}
                        className={`inline-flex items-center px-micro py-micro rounded-full text-chip border ${getBadgeColor(badge.color_token)}`}
                        role="listitem"
                        aria-label={`Badge: ${badge.label}`}
                      >
                        {badge.icon_url && (
                          <LazyImage
                            src={badge.icon_url}
                            alt={`${badge.label} badge icon`}
                            className="w-3 h-3 mr-1"
                            width={12}
                            height={12}
                          />
                        )}
                        <span>{badge.label}</span>
                      </div>
                    ))
                  ) : (
                    <div 
                      className="inline-flex items-center px-micro py-micro rounded-full text-chip bg-gray-100 text-gray-500 border border-gray-200"
                      role="listitem"
                      aria-label="No badges earned yet"
                    >
                      {getPlaceholder('NO_ACHIEVEMENTS')}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center icon-baseline icon-gap">
              <button 
                onClick={() => setIsCreatePostModalOpen(true)}
                className="min-h-[44px] px-base py-micro text-sm font-semibold text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors shadow-md"
                aria-label="Create new post"
              >
                <i className="fas fa-plus icon-edit" aria-hidden="true"></i>
                Create Post
              </button>
              <button 
                onClick={() => {
                  setIsEditModalOpen(true);
                }}
                className="min-h-[44px] px-base py-micro text-sm font-semibold text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors shadow-md"
                aria-label="Edit athlete profile"
              >
                <i className="fas fa-edit icon-edit" aria-hidden="true"></i>
                Edit Profile
              </button>
              <button
                onClick={() => {
                  signOut();
                }}
                className="min-h-[44px] px-micro py-micro text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                aria-label="Sign out of account"
              >
                <i className="fas fa-sign-out-alt icon-edit" aria-hidden="true"></i>
                Sign Out
              </button>
            </div>
          </div>

          {/* Vitals Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-micro space-base relative z-10">
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <InlineEdit
                field="height_cm"
                value={formatHeight(profile?.height_cm)}
                placeholder={getPlaceholder('NO_HEIGHT')}
                className="text-h3 text-gray-900 block"
                ariaLabel="Height in feet and inches"
                inputType="text"
              />
              <div className="text-chip text-gray-500 uppercase tracking-wide" id="height-label">Height</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <InlineEdit
                field="weight_display"
                value={(() => {
                  if (profile?.weight_display && profile?.weight_unit) {
                    return `${profile.weight_display} ${profile.weight_unit}`;
                  }
                  // Fallback to old format if weight_display doesn't exist yet
                  const formatted = formatWeightWithUnit(profile?.weight_kg, profile?.weight_unit);
                  return formatted;
                })()}
                placeholder={getPlaceholder('NO_WEIGHT')}
                className="text-h3 text-gray-900 block"
                ariaLabel="Weight"
                inputType="text"
              />
              <div className="text-chip text-gray-500 uppercase tracking-wide" id="weight-label">Weight</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <div className="text-h3 text-gray-900 block">
                {formatAge(profile?.dob)}
              </div>
              <div className="text-chip text-gray-500 uppercase tracking-wide">Age</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <InlineEdit
                field="location"
                value={profile?.location || ''}
                placeholder={getPlaceholder('NO_LOCATION')}
                className="text-h3 text-gray-900 block"
                ariaLabel="Location"
              />
              <div className="text-chip text-gray-500 uppercase tracking-wide">Location</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <InlineEdit
                field="class_year"
                value={profile?.class_year ? String(profile.class_year) : ''}
                placeholder={getPlaceholder('NO_CLASS_YEAR')}
                className="text-h3 text-gray-900 block"
                inputType="number"
                ariaLabel="Class year"
              />
              <div className="text-chip text-gray-500 uppercase tracking-wide">Class Year</div>
            </div>
          </div>

          {/* Socials Row */}
          <div className="flex items-center justify-center gap-base py-base border-t border-gray-200 relative z-10" role="list" aria-label="Social media links">
            <div className="flex items-center gap-micro" role="listitem">
              <i className="fab fa-twitter icon-social text-blue-400" aria-label="Twitter" aria-hidden="true"></i>
              <InlineEdit
                field="social_twitter"
                value={formatSocialHandleDisplay(profile?.social_twitter)}
                placeholder={getPlaceholder('ADD_TWITTER')}
                className="text-label text-gray-700"
                ariaLabel="Twitter handle"
              />
            </div>
            <div className="flex items-center gap-micro" role="listitem">
              <i className="fab fa-instagram icon-social text-pink-500" aria-label="Instagram" aria-hidden="true"></i>
              <InlineEdit
                field="social_instagram"
                value={formatSocialHandleDisplay(profile?.social_instagram)}
                placeholder={getPlaceholder('ADD_INSTAGRAM')}
                className="text-label text-gray-700"
                ariaLabel="Instagram handle"
              />
            </div>
            <div className="flex items-center gap-micro" role="listitem">
              <i className="fab fa-facebook icon-social text-blue-600" aria-label="Facebook" aria-hidden="true"></i>
              <InlineEdit
                field="social_facebook"
                value={formatSocialHandleDisplay(profile?.social_facebook)}
                placeholder="Add Facebook"
                className="text-label text-gray-700"
                ariaLabel="Facebook handle"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-micro pt-section pb-section gap-section flex flex-col">

        {/* Sport Highlights */}
        <MultiSportHighlights
          profileId={user?.id || ''}
          canEdit={true}
          onEdit={handleEditSeasonHighlights}
        />

        {/* Recent Activity */}
        <MultiSportActivity
          profileId={user?.id || ''}
          canEdit={true}
          onEdit={(sportKey: string, entityId?: string) => {
            if (sportKey === 'golf') {
              // For golf, edit performance
              const performance = performances.find(p => p.id === entityId);
              handleEditPerformance(performance);
            } else {
              // For other sports, show "coming soon"
            }
          }}
          onDelete={(sportKey: string, entityId: string) => {
            if (sportKey === 'golf') {
              // For golf, delete performance  
              handleDeletePerformance(entityId);
            } else {
              // For other sports, show "coming soon"
            }
          }}
        />
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
        onPostCreated={() => {
          // Refresh data to show new post
          if (user?.id) {
            loadAthleteData(user.id, true);
          }
          showSuccess('Post created successfully!');
        }}
      />
    </div>
  );
}