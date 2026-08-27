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

/** Max emoji/pictographs allowed in a display name — decoration, not a
 *  canvas. Counted via Unicode property escapes; flags/ZWJ sequences count
 *  per visible pictograph, which errs strict (the safe direction). */
export const MAX_DISPLAY_NAME_EMOJI = 3;

// Bidi controls (RLO/LRO/embeddings/isolates) reverse rendered text — the
// classic "gpj.exe" trick. They are impersonation tools, never names.
const BIDI_CONTROLS_RE = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Homoglyph normalization for the LOOK-ALIKE core: Cyrillic/Greek letters
 * that render identically to Latin. NFKC folds fullwidth/compatibility
 * forms but deliberately leaves these alone (distinct letters, not
 * compatibility variants). Genuinely non-Latin names (no Latin letters and
 * real non-confusable letters) pass through untouched — "José 山田" stays a
 * name; "Тom" (Cyrillic Т) can no longer impersonate "Tom".
 */
const CONFUSABLE_MAP: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'ј': 'j',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ѕ': 'S', 'Ј': 'J',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X', 'ο': 'o', 'ν': 'v',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE_MAP).join('')}]`, 'g');

/** Count pictographic characters (emoji) in a string. */
export function countEmoji(value: string): number {
  const matches = value.match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

/**
 * Sanitize display name (prevent spoofing, normalize unicode).
 * Layers: NFKC → strip controls/zero-widths → strip bidi overrides → fold
 * single-script confusables in visually-Latin names → cap emoji count →
 * length cap.
 */
export function sanitizeDisplayName(displayName: string): string {
  if (!displayName?.trim()) return '';

  // Trim whitespace
  let sanitized = displayName.trim();

  // Normalize unicode (prevent look-alike attacks)
  sanitized = sanitized.normalize('NFKC');

  // Remove control characters and zero-width spaces
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');

  // Remove bidi overrides/isolates (text-direction spoofing)
  sanitized = sanitized.replace(BIDI_CONTROLS_RE, '');

  // Fold Cyrillic/Greek lookalikes into their Latin twins when the name is
  // visually Latin (has Latin letters, or has no genuine non-Latin letters
  // beyond the confusables themselves).
  const hasLatin = /[A-Za-z]/.test(sanitized);
  const hasGenuineNonLatin = /\p{L}/u.test(
    sanitized.replace(CONFUSABLE_RE, '').replace(/[A-Za-z]/g, '')
  );
  if (hasLatin || !hasGenuineNonLatin) {
    sanitized = sanitized.replace(CONFUSABLE_RE, ch => CONFUSABLE_MAP[ch] ?? ch);
  }

  // Cap emoji: keep the first MAX_DISPLAY_NAME_EMOJI pictographs.
  let emojiSeen = 0;
  sanitized = sanitized.replace(/\p{Extended_Pictographic}/gu, m =>
    ++emojiSeen > MAX_DISPLAY_NAME_EMOJI ? '' : m
  );

  // Collapse whitespace runs left behind by removals
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();

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
