/**
 * CENTRALIZED NAME RESOLVER
 * =========================
 * Single source of truth for user display names across the entire platform.
 *
 * RULES:
 * 1. display_name is the ONLY field shown to other users
 * 2. If display_name is missing, fall back to "first_name last_name"
 * 3. If names are missing, fall back to username/handle
 * 4. username/full_name is ONLY for login/URLs/@mentions, NOT display
 *
 * ALL code must use this resolver instead of reading fields directly.
 */

import { formatDisplayName } from './formatters';

// Profile interface for name resolution
export interface NameResolverProfile {
  id: string;
  display_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;  // username/handle
  username?: string | null;    // alternative handle
  updated_at?: string | null;  // for cache invalidation
}

// Resolved name with metadata
export interface ResolvedName {
  displayName: string;          // What to show users
  handle: string;               // For @mentions and URLs
  source: 'display_name' | 'constructed_name' | 'username' | 'fallback';
  timestamp?: string;           // For cache validation
}

/**
 * CORE RESOLVER FUNCTION
 * This is the ONLY function that should determine what name to display
 */
export function resolveDisplayName(profile: NameResolverProfile | null | undefined): ResolvedName {
  if (!profile) {
    return {
      displayName: 'Unknown User',
      handle: 'unknown',
      source: 'fallback'
    };
  }

  // RULE 1: display_name is the single source of truth
  if (profile.display_name?.trim()) {
    return {
      displayName: profile.display_name.trim(),
      handle: profile.full_name || profile.username || profile.id.substring(0, 8),
      source: 'display_name',
      timestamp: profile.updated_at || undefined
    };
  }

  // RULE 2: Construct from first_name + middle_name + last_name
  const constructedName = formatDisplayName(
    profile.first_name,
    profile.middle_name,
    profile.last_name,
    undefined  // Don't use username as fallback here
  );

  if (constructedName !== 'Unknown User') {
    return {
      displayName: constructedName,
      handle: profile.full_name || profile.username || profile.id.substring(0, 8),
      source: 'constructed_name',
      timestamp: profile.updated_at || undefined
    };
  }

  // RULE 3: Fall back to username/handle (for login/URLs only)
  const handle = profile.full_name || profile.username;
  if (handle?.trim()) {
    return {
      displayName: handle.trim(),
      handle: handle.trim(),
      source: 'username',
      timestamp: profile.updated_at || undefined
    };
  }

  // RULE 4: Absolute fallback
  return {
    displayName: 'Unknown User',
    handle: profile.id.substring(0, 8),
    source: 'fallback',
    timestamp: profile.updated_at || undefined
  };
}

/**
 * Convenience function - just get the display name string
 */
export function getDisplayName(profile: NameResolverProfile | null | undefined): string {
  return resolveDisplayName(profile).displayName;
}

/**
 * Convenience function - just get the handle string
 */
export function getHandle(profile: NameResolverProfile | null | undefined): string {
  return resolveDisplayName(profile).handle;
}

/**
 * Batch resolver for multiple profiles (optimized)
 */
export function resolveDisplayNames(profiles: (NameResolverProfile | null | undefined)[]): ResolvedName[] {
  return profiles.map(resolveDisplayName);
}

/**
 * Check if a profile has a valid display name set
 */
export function hasDisplayName(profile: NameResolverProfile | null | undefined): boolean {
  if (!profile) return false;
  return !!profile.display_name?.trim();
}

/**
 * Truncate long display names consistently
 * Apply this to ALL display surfaces
 */
export function truncateDisplayName(displayName: string, maxLength: number = 50): string {
  if (displayName.length <= maxLength) {
    return displayName;
  }
  return displayName.substring(0, maxLength - 1) + '…';
}

/**
 * Sanitize display name (prevent spoofing, normalize unicode)
 * TODO: Add confusables detection and emoji limits
 */
export function sanitizeDisplayName(displayName: string): string {
  if (!displayName?.trim()) return '';

  // Trim whitespace
  let sanitized = displayName.trim();

  // Normalize unicode (prevent look-alike attacks)
  sanitized = sanitized.normalize('NFKC');

  // Remove control characters and zero-width spaces
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');

  // Limit length
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  return sanitized;
}

/**
 * Validate display name for profile updates
 */
export interface DisplayNameValidation {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

export function validateDisplayName(displayName: string): DisplayNameValidation {
  if (!displayName?.trim()) {
    return { valid: false, error: 'Display name cannot be empty' };
  }

  const sanitized = sanitizeDisplayName(displayName);

  if (sanitized.length < 1) {
    return { valid: false, error: 'Display name must contain visible characters' };
  }

  if (sanitized.length > 100) {
    return { valid: false, error: 'Display name must be 100 characters or less' };
  }

  // Check for suspicious patterns (all spaces, only emojis, etc.)
  const hasLettersOrNumbers = /[a-zA-Z0-9]/.test(sanitized);
  if (!hasLettersOrNumbers) {
    return { valid: false, error: 'Display name must contain at least one letter or number' };
  }

  return { valid: true, sanitized };
}

/**
 * Privacy-aware resolver (for blocked/private users)
 */
export function resolveDisplayNameWithPrivacy(
  profile: NameResolverProfile | null | undefined,
  options: {
    isBlocked?: boolean;
    isPrivate?: boolean;
    canView?: boolean;
  } = {}
): ResolvedName {
  // If user is blocked, mask their identity
  if (options.isBlocked) {
    return {
      displayName: 'Blocked User',
      handle: 'blocked',
      source: 'fallback'
    };
  }

  // If profile is private and viewer can't see it
  if (options.isPrivate && !options.canView) {
    return {
      displayName: 'Private User',
      handle: 'private',
      source: 'fallback'
    };
  }

  // Otherwise use normal resolution
  return resolveDisplayName(profile);
}

/**
 * Get name with @ prefix for mentions
 */
export function getMentionName(profile: NameResolverProfile | null | undefined): string {
  const handle = getHandle(profile);
  return `@${handle}`;
}

/**
 * Cache key generator for display names
 * Use this for Redis/memory caching
 */
export function getDisplayNameCacheKey(profileId: string): string {
  return `display_name:${profileId}`;
}

/**
 * Generate cache metadata for invalidation
 */
export function getDisplayNameVersion(profile: NameResolverProfile): string {
  // Use updated_at or generate from name fields
  if (profile.updated_at) {
    return new Date(profile.updated_at).getTime().toString();
  }

  // Fallback: hash of name fields
  const nameString = [
    profile.display_name,
    profile.first_name,
    profile.middle_name,
    profile.last_name
  ].filter(Boolean).join('|');

  return Buffer.from(nameString).toString('base64').substring(0, 16);
}
