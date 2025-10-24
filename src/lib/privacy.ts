/**
 * Privacy System
 *
 * Handles profile visibility and access control
 * Simple public/private now, with infrastructure for granular controls later
 */

import { supabaseAdmin } from './supabase';

export type ProfileVisibility = 'public' | 'private';
export type ContentVisibility = 'public' | 'private' | 'friends' | 'inherit';

export interface PrivacySettings {
  profile_visibility: ProfileVisibility;
  media_visibility?: ContentVisibility;
  stats_visibility?: ContentVisibility;
  posts_visibility?: ContentVisibility;
  activity_visibility?: ContentVisibility;
}

export interface PrivacyCheckResult {
  canView: boolean;
  limitedAccess: boolean;
  reason?: 'own_profile' | 'public' | 'following' | 'not_following' | 'not_found';
}

/**
 * Check if current user can view a profile
 * This is the main access control function
 */
export async function canViewProfile(
  profileId: string,
  currentUserId: string | null
): Promise<PrivacyCheckResult> {
  // No user logged in - can't view
  if (!currentUserId) {
    return {
      canView: false,
      limitedAccess: true,
      reason: 'not_following'
    };
  }

  // Own profile - always true
  if (profileId === currentUserId) {
    return {
      canView: true,
      limitedAccess: false,
      reason: 'own_profile'
    };
  }

  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not configured');
  }

  // Check profile visibility
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('visibility')
    .eq('id', profileId)
    .single();

  if (profileError || !profile) {
    return {
      canView: false,
      limitedAccess: true,
      reason: 'not_found'
    };
  }

  // Public profile - anyone can view
  if (profile.visibility === 'public') {
    return {
      canView: true,
      limitedAccess: false,
      reason: 'public'
    };
  }

  // Private profile - check if following
  const { data: followRelation } = await supabaseAdmin
    .from('follows')
    .select('status')
    .eq('follower_id', currentUserId)
    .eq('following_id', profileId)
    .maybeSingle();

  if (followRelation?.status === 'accepted') {
    return {
      canView: true,
      limitedAccess: false,
      reason: 'following'
    };
  }

  // Private and not following
  return {
    canView: false,
    limitedAccess: true,
    reason: 'not_following'
  };
}

/**
 * Get profile data with privacy enforcement
 * Returns limited data if user can't view full profile
 */
export async function getProfileWithPrivacy(
  profileId: string,
  currentUserId: string | null
) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not configured');
  }

  const privacyCheck = await canViewProfile(profileId, currentUserId);

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single();

  if (error || !profile) {
    return null;
  }

  // If can't view, return limited data only
  if (!privacyCheck.canView) {
    return {
      id: profile.id,
      full_name: profile.full_name,
      first_name: profile.first_name,
      last_name: profile.last_name,
      avatar_url: profile.avatar_url,
      sport: profile.sport,
      school: profile.school,
      visibility: profile.visibility,
      isPrivate: true,
      limitedAccess: true,
      privacyReason: privacyCheck.reason
    };
  }

  // Full access
  return {
    ...profile,
    isPrivate: false,
    limitedAccess: false,
    privacyReason: privacyCheck.reason
  };
}

/**
 * Update profile visibility
 */
export async function updateProfileVisibility(
  profileId: string,
  visibility: ProfileVisibility,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  // Must be own profile
  if (profileId !== currentUserId) {
    return {
      success: false,
      error: 'Can only update your own privacy settings'
    };
  }

  if (!supabaseAdmin) {
    return {
      success: false,
      error: 'Supabase admin client not configured'
    };
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ visibility })
    .eq('id', profileId);

  if (error) {
    return {
      success: false,
      error: error.message
    };
  }

  return { success: true };
}

/**
 * Get privacy settings for a profile
 */
export async function getPrivacySettings(
  profileId: string,
  currentUserId: string
): Promise<PrivacySettings | null> {
  // Must be own profile
  if (profileId !== currentUserId) {
    return null;
  }

  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('privacy_settings')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error || !data) {
    // Return default settings
    return {
      profile_visibility: 'public',
      media_visibility: 'inherit',
      stats_visibility: 'inherit',
      posts_visibility: 'inherit',
      activity_visibility: 'inherit'
    };
  }

  return {
    profile_visibility: data.profile_visibility,
    media_visibility: data.media_visibility,
    stats_visibility: data.stats_visibility,
    posts_visibility: data.posts_visibility,
    activity_visibility: data.activity_visibility
  };
}

/**
 * Update granular privacy settings (future feature)
 */
export async function updatePrivacySettings(
  profileId: string,
  settings: Partial<PrivacySettings>,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  // Must be own profile
  if (profileId !== currentUserId) {
    return {
      success: false,
      error: 'Can only update your own privacy settings'
    };
  }

  if (!supabaseAdmin) {
    return {
      success: false,
      error: 'Supabase admin client not configured'
    };
  }

  // Update or create privacy_settings
  const { error } = await supabaseAdmin
    .from('privacy_settings')
    .upsert({
      profile_id: profileId,
      ...settings,
      updated_at: new Date().toISOString()
    });

  if (error) {
    return {
      success: false,
      error: error.message
    };
  }

  return { success: true };
}

/**
 * Helper to get privacy display text
 */
export function getPrivacyDisplayText(visibility: ProfileVisibility): {
  label: string;
  description: string;
  icon: string;
  color: string;
} {
  if (visibility === 'public') {
    return {
      label: 'Public Profile',
      description: 'Anyone can view your profile and posts',
      icon: 'fa-globe',
      color: 'green'
    };
  }

  return {
    label: 'Private Profile',
    description: 'Only approved followers can view your profile and posts',
    icon: 'fa-lock',
    color: 'orange'
  };
}

/**
 * Helper to check if content should be visible based on granular settings
 * For future use when granular controls are implemented
 */
export function shouldShowContent(
  contentType: 'media' | 'stats' | 'posts' | 'activity',
  privacySettings: PrivacySettings,
  isFollowing: boolean
): boolean {
  const setting = privacySettings[`${contentType}_visibility`];

  // Inherit from profile visibility
  if (setting === 'inherit' || !setting) {
    return privacySettings.profile_visibility === 'public' || isFollowing;
  }

  // Check specific setting
  if (setting === 'public') return true;
  if (setting === 'private') return isFollowing;
  if (setting === 'friends') return isFollowing; // For now, friends = followers

  return false;
}
