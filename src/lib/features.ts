/**
 * Feature Flags System
 * 
 * Central management of feature enablement across the application.
 * Toggling features here should enable/disable them throughout the UI.
 */

import type { SportKey } from './sports/SportRegistry';

// Feature Flag Configuration
export const FEATURE_FLAGS = {
  // Sports Features - Controls which sports are enabled in the UI
  FEATURE_SPORTS: ['golf', 'ice_hockey', 'volleyball'] as SportKey[],
  
  // Future feature flags can be added here
  // FEATURE_PUBLIC_PROFILES: false,
  // FEATURE_MESSAGING: false,
  // FEATURE_TOURNAMENTS: false,
} as const;

/**
 * Check if a specific sport is enabled via feature flags
 */
export function isSportEnabled(sportKey: SportKey): boolean {
  return FEATURE_FLAGS.FEATURE_SPORTS.includes(sportKey);
}

/**
 * Get all enabled sports from feature flags
 */
export function getEnabledSportKeys(): SportKey[] {
  return [...FEATURE_FLAGS.FEATURE_SPORTS];
}

/**
 * Check if any sports are enabled
 */
export function hasEnabledSports(): boolean {
  return FEATURE_FLAGS.FEATURE_SPORTS.length > 0;
}

/**
 * Get feature flag value by key
 */
export function getFeatureFlag<K extends keyof typeof FEATURE_FLAGS>(key: K): typeof FEATURE_FLAGS[K] {
  return FEATURE_FLAGS[key];
}

/**
 * Development helper - log current feature flag status
 */
export function logFeatureFlags(): void {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    // Feature flags loaded
  }
}

// Export for easy testing and debugging
export { FEATURE_FLAGS as flags };