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
  FEATURE_SPORTS: ['golf', 'ice_hockey', 'volleyball', 'basketball', 'soccer', 'baseball', 'track_field'] as SportKey[],
  
  // Parent-managed athlete profiles (guardian/supervised/owner/viewer roles,
  // DOB-gated signup, transfer of control). Build-time env flag (same
  // pattern as the OAuth provider flags). LAUNCHED to prod Aug 19 2026 —
  // the flag is SET in Vercel; keep it set. Migrations 048-051 must be run
  // before this is ever enabled in a fresh environment.
  //
  // SEMANTICS (Family Console Wave 1, Aug 2026): this is a SURFACE switch,
  // never a safety switch. Flag off hides the guardian pages, funnels and
  // acting-as entry points; it must NEVER disable a publish filter, the
  // supervised pending/held pipelines, the deletion rails, supervised login,
  // or the invite gate — those run unconditionally and are role/state-driven.
  // (The flag started life as a migration guard for 048-051; turning it off
  // used to REMOVE the posts.status filters, which would have published
  // minors' unapproved content. Never reintroduce a flag check on a safety
  // behavior.)
  FEATURE_GUARDIAN_PROFILES: process.env.NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES === '1',

  // RETIRED (consolidation round, Sep 2026) — behavior now unconditional:
  // FEATURE_CALENDAR, FEATURE_CHAT_DOCK (launched surfaces),
  // FEATURE_ROSTER_GUARDIAN_GATE (either-approves is permanent),
  // FEATURE_CALENDAR_ROSTER_ONLY (roster-only placement is permanent).
  // Never reintroduce a flag on a retired safety behavior.

  /**
   * Phase 5 (migs 161/162): family-initiated org registration. A pure
   * SURFACE switch (the flag doctrine above): off hides the wizard/CTAs
   * and 404s the submit route — every safety check (supervised gating,
   * window open-ness, collision rules) runs unconditionally when on.
   */
  FEATURE_ORG_REGISTRATION: process.env.NEXT_PUBLIC_FEATURE_ORG_REGISTRATION === '1',

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