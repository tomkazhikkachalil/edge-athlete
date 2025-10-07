/**
 * Profile Display Utilities
 *
 * Helper functions for displaying user names and handles consistently
 */

import { formatDisplayName } from './formatters';

export interface ProfileDisplay {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  handle?: string | null;
  id?: string;
}

/**
 * Get user's display name (First Last)
 * Example: "Tom Kazhikkachalil"
 */
export function getDisplayName(profile: ProfileDisplay): string {
  return formatDisplayName(
    profile.first_name,
    null,  // No middle name (per CLAUDE.md)
    profile.last_name,
    profile.full_name
  );
}

/**
 * Get user's handle with @ prefix
 * Example: "@tomk"
 */
export function getHandle(profile: ProfileDisplay): string {
  if (!profile.handle) return '';
  return `@${profile.handle}`;
}

/**
 * Get user's handle without @ prefix (for URLs and database queries)
 * Example: "tomk"
 */
export function getHandleRaw(profile: ProfileDisplay): string {
  return profile.handle || '';
}

/**
 * Get profile URL using handle (preferred) or fallback to ID
 * Example: "/u/@tomk" or "/athlete/uuid"
 */
export function getProfileUrl(profile: ProfileDisplay): string {
  if (profile.handle) {
    return `/u/@${profile.handle}`;
  }
  // Fallback to ID-based URL
  return `/athlete/${profile.id}`;
}

/**
 * Format full user identifier for display
 * Shows: "Tom Kazhikkachalil @tomk"
 */
export function getFullIdentifier(profile: ProfileDisplay): string {
  const displayName = getDisplayName(profile);
  const handle = getHandle(profile);

  if (handle) {
    return `${displayName} ${handle}`;
  }
  return displayName;
}

/**
 * Check if profile has a handle assigned
 */
export function hasHandle(profile: ProfileDisplay): boolean {
  return Boolean(profile.handle && profile.handle.length > 0);
}

/**
 * Get display name OR handle (fallback)
 * Useful when you need something to show even if name is missing
 */
export function getNameOrHandle(profile: ProfileDisplay): string {
  const displayName = getDisplayName(profile);
  if (displayName && displayName !== 'Unknown User') {
    return displayName;
  }
  return getHandle(profile) || 'Unknown User';
}

/**
 * Format for compact display (name with handle in parentheses)
 * Example: "Tom Kazhikkachalil (@tomk)"
 */
export function getCompactIdentifier(profile: ProfileDisplay): string {
  const displayName = getDisplayName(profile);
  const handle = getHandle(profile);

  if (handle) {
    return `${displayName} (${handle})`;
  }
  return displayName;
}
