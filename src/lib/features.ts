/**
 * Feature Flags System
 * 
 * Central management of feature enablement across the application.
 * Toggling features here should enable/disable them throughout the UI.
 */

import type { SportKey } from './sports/SportRegistry';

// Feature Flag Configuration
export const FEATURE_FLAGS = {
  // Sports Features - Controls which sports are enabled in the UI.
  // MUST stay in sync with `enabled: true` sports in SportRegistry.ts and the
  // statLineSports list in AdapterRegistry.ts (see CLAUDE.md "Add a New Sport").
  FEATURE_SPORTS: ['golf', 'ice_hockey', 'volleyball', 'basketball', 'soccer', 'baseball'] as SportKey[],
  
  // Parent-managed athlete profiles (guardian/supervised/owner/viewer roles,
  // DOB-gated signup, transfer of control). Build-time env flag (same
  // pattern as the OAuth provider flags): set
  // NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES=1 locally to develop/test;
  // leave unset in Vercel until launch. Migrations 048-051 must be run
  // before this is ever enabled in an environment.
  FEATURE_GUARDIAN_PROFILES: process.env.NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES === '1',

  // Personal calendar (events + invite loop). Build-time env flag: set
  // NEXT_PUBLIC_FEATURE_CALENDAR=1 locally to develop/test; leave unset in
  // Vercel until launch. Migration 057 must be run before this is ever
  // enabled in an environment.
  FEATURE_CALENDAR: process.env.NEXT_PUBLIC_FEATURE_CALENDAR === '1',

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