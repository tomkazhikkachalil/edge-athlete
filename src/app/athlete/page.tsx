'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { AthleteService } from '@/lib/athleteService';
import EditProfileTabs from '@/components/EditProfileTabs';
import { ToastContainer, useToast } from '@/components/Toast';
import SeasonHighlights from '@/components/SeasonHighlights';
import SeasonHighlightsModal from '@/components/SeasonHighlightsModal';
import LazyImage from '@/components/LazyImage';
import type { AthleteBadge, SeasonHighlight, Performance, Profile } from '@/lib/supabase';
import { 
  formatHeight, 
  formatWeightWithUnit, 
  formatAge, 
  formatDate,
  formatDisplayName,
  getInitials,
  formatSocialHandleDisplay,
  validateHeight
} from '@/lib/formatters';
import { 
  PLACEHOLDERS,
  getPlaceholder,
  formatEmptyValue
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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [submitStates, setSubmitStates] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toasts, dismissToast } = useToast();
  
  // Inline editing states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [tempValues, setTempValues] = useState<Record<string, string>>({});

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      console.log('No user found, redirecting to login...');
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

      console.log('=== PROFILE SAVE DEBUG START ===');
      console.log('HandleSaveProfile called with updates:', JSON.stringify(updates, null, 2));
      console.log('User ID:', user.id);
      console.log('Badge updates:', JSON.stringify(badgeUpdates, null, 2));
      
      const requestBody = {
        profileData: updates,
        userId: user.id
      };
      console.log('Request body being sent:', JSON.stringify(requestBody, null, 2));

      // Save profile updates
      console.log('Making fetch request to /api/profile...');
      const profileResponse = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('Profile response received!');
      console.log('Profile response status:', profileResponse.status);
      console.log('Profile response statusText:', profileResponse.statusText);
      console.log('Profile response ok:', profileResponse.ok);
      
      // Always try to get the response text first
      const responseText = await profileResponse.text();
      console.log('Profile response raw text:', responseText);
      
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
        const result = responseText ? JSON.parse(responseText) : {};
        console.log('Profile save result (parsed):', result);
        console.log('=== PROFILE SAVE DEBUG END ===');
      } catch (parseError) {
        console.error('Failed to parse success response:', parseError);
        console.log('Response was successful but not JSON, raw text:', responseText);
      }

      // TODO: Implement badge updates API if needed
      if (badgeUpdates.length > 0) {
        console.log('Badge updates not yet implemented:', badgeUpdates);
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

      // Refresh the data instead of full page reload - do it in background
      if (user?.id) {
        // Don't await - let it happen in background for faster UI response
        refreshProfile();
        loadAthleteData(user.id, true); // Skip loading state for background refresh
      }
    } catch (error) {
      console.error('Season highlights save error:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to save season highlights');
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
      console.log('Avatar Upload: Starting upload for file:', file.name);
      console.log('Avatar Upload: File details:', {
        name: file.name,
        size: file.size,
        type: file.type
      });

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

      console.log('Avatar Upload: Success! Refreshing data...');
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
        console.log('Height edit from formatted:', currentValue);
        editValue = currentValue;
      }
    } else if (field === 'weight_display') {
      // For weight, show the current value with unit for editing
      if (profile?.weight_display) {
        editValue = `${profile.weight_display} ${profile.weight_unit || 'lbs'}`;
        console.log('Weight edit init:', profile.weight_display, profile.weight_unit);
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
      console.log('Height conversion:', newValue, '→', validation.value ? validation.value + ' cm' : 'invalid');
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
      
      console.log('Weight save:', { input, value, unit });
      
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
                  className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold px-micro py-micro rounded-full border-2 border-white"
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
                      <i className="fas fa-camera text-white text-sm" aria-hidden="true"></i>
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
                  className="text-3xl font-bold text-gray-900 space-micro block"
                  ariaLabel="Athlete name"
                />
                <InlineEdit
                  field="bio"
                  value={profile?.bio || ''}
                  placeholder={getPlaceholder('ADD_BIO')}
                  className="text-gray-700 space-micro leading-relaxed block"
                  multiline={true}
                  ariaLabel="Athlete biography"
                />
                
                {/* Top Badges */}
                <div className="flex flex-wrap gap-micro" role="list" aria-label="Athlete badges">
                  {badges.length > 0 ? (
                    badges.slice(0, 3).map((badge: AthleteBadge) => (
                      <div
                        key={badge.id}
                        className={`inline-flex items-center px-micro py-micro rounded-full text-xs font-medium border ${getBadgeColor(badge.color_token)}`}
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
                      className="inline-flex items-center px-micro py-micro rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200"
                      role="listitem"
                      aria-label="No badges earned yet"
                    >
                      {getPlaceholder('NO_ACHIEVEMENTS')}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Edit and Sign Out Buttons */}
            <div className="flex items-center gap-micro">
              <button 
                onClick={() => {
                  console.log('Edit Profile clicked');
                  setIsEditModalOpen(true);
                }}
                className="min-h-[44px] px-base py-micro text-sm font-semibold text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors shadow-md"
                aria-label="Edit athlete profile"
              >
                <i className="fas fa-edit" aria-hidden="true"></i>
                Edit Profile
              </button>
              <button
                onClick={() => {
                  console.log('Sign Out button clicked');
                  signOut();
                }}
                className="min-h-[44px] px-micro py-micro text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                aria-label="Sign out of account"
              >
                <i className="fas fa-sign-out-alt" aria-hidden="true"></i>
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
                className="text-lg font-semibold text-gray-900 block"
                ariaLabel="Height in feet and inches"
                inputType="text"
              />
              <div className="text-xs text-gray-500 uppercase tracking-wide" id="height-label">Height</div>
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
                  console.log('Weight display fallback:', {
                    weight_kg: profile?.weight_kg,
                    weight_unit: profile?.weight_unit,
                    weight_display: profile?.weight_display,
                    formatted
                  });
                  return formatted;
                })()}
                placeholder={getPlaceholder('NO_WEIGHT')}
                className="text-lg font-semibold text-gray-900 block"
                ariaLabel="Weight"
                inputType="text"
              />
              <div className="text-xs text-gray-500 uppercase tracking-wide" id="weight-label">Weight</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <div className="text-lg font-semibold text-gray-900 block">
                {formatAge(profile?.dob)}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Age</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <InlineEdit
                field="location"
                value={profile?.location || ''}
                placeholder={getPlaceholder('NO_LOCATION')}
                className="text-lg font-semibold text-gray-900 block"
                ariaLabel="Location"
              />
              <div className="text-xs text-gray-500 uppercase tracking-wide">Location</div>
            </div>
            <div className="text-center p-micro bg-gray-50 rounded-lg border">
              <InlineEdit
                field="class_year"
                value={profile?.class_year ? String(profile.class_year) : ''}
                placeholder={getPlaceholder('NO_CLASS_YEAR')}
                className="text-lg font-semibold text-gray-900 block"
                inputType="number"
                ariaLabel="Class year"
              />
              <div className="text-xs text-gray-500 uppercase tracking-wide">Class Year</div>
            </div>
          </div>

          {/* Socials Row */}
          <div className="flex items-center justify-center gap-base py-base border-t border-gray-200 relative z-10" role="list" aria-label="Social media links">
            <div className="flex items-center gap-micro" role="listitem">
              <i className="fab fa-twitter text-blue-400 text-lg" aria-label="Twitter" aria-hidden="true"></i>
              <InlineEdit
                field="social_twitter"
                value={formatSocialHandleDisplay(profile?.social_twitter)}
                placeholder={getPlaceholder('ADD_TWITTER')}
                className="text-gray-700 text-sm"
                ariaLabel="Twitter handle"
              />
            </div>
            <div className="flex items-center gap-micro" role="listitem">
              <i className="fab fa-instagram text-pink-500 text-lg" aria-label="Instagram" aria-hidden="true"></i>
              <InlineEdit
                field="social_instagram"
                value={formatSocialHandleDisplay(profile?.social_instagram)}
                placeholder={getPlaceholder('ADD_INSTAGRAM')}
                className="text-gray-700 text-sm"
                ariaLabel="Instagram handle"
              />
            </div>
            <div className="flex items-center gap-micro" role="listitem">
              <i className="fab fa-facebook text-blue-600 text-lg" aria-label="Facebook" aria-hidden="true"></i>
              <InlineEdit
                field="social_facebook"
                value={formatSocialHandleDisplay(profile?.social_facebook)}
                placeholder="Add Facebook"
                className="text-gray-700 text-sm"
                ariaLabel="Facebook handle"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-micro pt-section pb-section gap-section flex flex-col">

        {/* Season Highlights */}
        <SeasonHighlights
          highlights={highlights}
          badges={badges}
          onEdit={handleEditSeasonHighlights}
          canEdit={true}
        />

        {/* Recent Performances */}
        <div className="bg-white rounded-lg shadow-sm p-base">
          <h2 className="text-lg font-semibold text-gray-900 space-base">Recent Performances</h2>
          {performances.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-micro py-micro text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-micro py-micro text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Event
                    </th>
                    <th className="px-micro py-micro text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Result
                    </th>
                    <th className="px-micro py-micro text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Time/Score
                    </th>
                    <th className="px-micro py-micro text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Organization
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {performances.map((performance: Performance) => (
                    <tr key={performance.id}>
                      <td className="px-micro py-micro whitespace-nowrap text-sm text-gray-900">
                        {formatDate(performance.date)}
                      </td>
                      <td className="px-micro py-micro whitespace-nowrap text-sm text-gray-900">
                        {formatEmptyValue(performance.event)}
                      </td>
                      <td className="px-micro py-micro whitespace-nowrap text-sm text-gray-900">
                        {formatEmptyValue(performance.result_place)}
                      </td>
                      <td className="px-micro py-micro whitespace-nowrap text-sm text-gray-900">
                        {formatEmptyValue(performance.stat_primary)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                        {formatEmptyValue(performance.organization)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500" role="status" aria-label="No performances available">
              <i className="fas fa-chart-line text-4xl text-gray-300 mb-3" aria-hidden="true"></i>
              <p>{getPlaceholder('NO_PERFORMANCES')}</p>
              <p className="text-sm">Add your competition results to track progress!</p>
            </div>
          )}
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
    </div>
  );
}