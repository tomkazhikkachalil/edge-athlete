/**
 * Application-wide configuration settings
 * Centralized configuration for the athlete recruitment platform
 */

/**
 * Active season configuration
 * This determines the current recruiting season displayed throughout the app
 */
export const ACTIVE_SEASON = '2024–25';

/**
 * Get the current active season
 * Can be extended to derive from current date or external configuration
 */
export function getActiveSeason(): string {
  // Could be enhanced to calculate based on current date
  // For now, returns the configured static value
  return ACTIVE_SEASON;
}

/**
 * Get season display name
 * Formats the season for display purposes
 */
export function getSeasonDisplayName(season?: string): string {
  const activeSeason = season || getActiveSeason();
  return `${activeSeason} Season`;
}

/**
 * Placeholder strings used throughout the application
 * Ensures consistency in empty state displays
 */
export const PLACEHOLDERS = {
  // Data placeholders
  EMPTY_VALUE: '—',
  NOT_SPECIFIED: 'Not specified',
  NOT_PROVIDED: 'Not provided',
  NO_DATA: 'No data available',
  
  // Profile placeholders
  ADD_TWITTER: 'Add Twitter',
  ADD_INSTAGRAM: 'Add Instagram',
  ADD_TIKTOK: 'Add TikTok',
  ADD_YOUTUBE: 'Add YouTube',
  ADD_BIO: 'Add your bio',
  NO_LOCATION: 'Location not set',
  NO_HEIGHT: 'Add height',
  NO_WEIGHT: 'Add weight',
  NO_SCHOOL: 'Add school',
  NO_HOMETOWN: 'Add hometown',
  
  // Performance placeholders
  NO_PERFORMANCES: 'No performances yet',
  NO_EVENTS: 'No events recorded',
  NO_ACHIEVEMENTS: 'No achievements yet',
  NO_HIGHLIGHTS: 'No highlights added',
  NO_SEASON_BESTS: 'No season bests recorded',
  
  // Athletic placeholders
  NO_SPORT: 'Sport not selected',
  NO_POSITION: 'Position not set',
  NO_CLASS_YEAR: 'Class year not set',
  NO_GPA: 'GPA not provided',
  NO_SAT: 'SAT not provided',
  NO_ACT: 'ACT not provided',
  
  // Coach/Team placeholders
  NO_COACH: 'Coach not assigned',
  NO_TEAM: 'Team not set',
  NO_CLUB: 'Club not specified',
  
  // Loading states
  LOADING: 'Loading...',
  SAVING: 'Saving...',
  UPDATING: 'Updating...',
  PROCESSING: 'Processing...',
} as const;

/**
 * Get placeholder value
 * Helper function to get placeholder with optional fallback
 */
export function getPlaceholder(key: keyof typeof PLACEHOLDERS, fallback?: string): string {
  return PLACEHOLDERS[key] || fallback || PLACEHOLDERS.EMPTY_VALUE;
}

/**
 * Format empty value
 * Returns appropriate placeholder for empty/null/undefined values
 */
export function formatEmptyValue(value: unknown, placeholder?: string): string {
  if (value === null || value === undefined || value === '') {
    return placeholder || PLACEHOLDERS.EMPTY_VALUE;
  }
  return String(value);
}

/**
 * Application metadata
 */
export const APP_CONFIG = {
  name: 'Elite Athlete Recruitment',
  shortName: 'EAR',
  description: 'Elite athlete recruitment platform',
  version: '1.0.0',
  
  // URLs and paths
  baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  apiUrl: process.env.NEXT_PUBLIC_API_URL || '/api',
  
  // Features
  features: {
    socialMedia: true,
    seasonHighlights: true,
    badges: true,
    videoUploads: true,
    performanceTracking: true,
    academicInfo: true,
  },
  
  // Limits
  limits: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    maxAvatarSize: 2 * 1024 * 1024, // 2MB
    maxHighlights: 10,
    maxBadges: 20,
    maxSeasonBests: 15,
    bioMaxLength: 500,
  },
} as const;

/**
 * Get app feature flag
 */
export function isFeatureEnabled(feature: keyof typeof APP_CONFIG.features): boolean {
  return APP_CONFIG.features[feature] ?? false;
}

/**
 * Get app limit value
 */
export function getAppLimit(limit: keyof typeof APP_CONFIG.limits): number {
  return APP_CONFIG.limits[limit];
}