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

  // Personal calendar (events + invite loop). Build-time env flag: set
  // NEXT_PUBLIC_FEATURE_CALENDAR=1 locally to develop/test; leave unset in
  // Vercel until launch. Migration 057 must be run before this is ever
  // enabled in an environment.
  FEATURE_CALENDAR: process.env.NEXT_PUBLIC_FEATURE_CALENDAR === '1',

  // Persistent chat dock (big screens; the FB/LinkedIn bottom-corner
  // pattern). Pure view layer over the existing messaging system — no
  // migrations. Rides the root layout, so it ships dark and Tom flips it
  // after testing.
  FEATURE_CHAT_DOCK: process.env.NEXT_PUBLIC_FEATURE_CHAT_DOCK === '1',

  // 0.10 flag 1 — guardian roster gate. OFF (unset) = the stricter state:
  // supervised athletes can't be offered roster spots (403) and can't
  // accept (403). ON = offers to supervised athletes create the pending
  // row, bell the guardians (roster_invite), surface in the guardian
  // queue, and EITHER the child or a guardian accepts. Migration 147 must
  // be run before this is enabled anywhere.
  FEATURE_ROSTER_GUARDIAN_GATE: process.env.NEXT_PUBLIC_FEATURE_ROSTER_GUARDIAN_GATE === '1',

  // 0.10 flag 2 — roster-only calendar placement. OFF (unset) = today's
  // kind-blind merge (every org member gets org events on their calendar).
  // ON = only kind='roster' status='active' memberships place events
  // (follow members still see org pages and can opt in by RSVP).
  // ORDERING: flip this ONLY after orgs have converted members to roster
  // (phase 1) — flipping it day one empties every org calendar.
  FEATURE_CALENDAR_ROSTER_ONLY: process.env.NEXT_PUBLIC_FEATURE_CALENDAR_ROSTER_ONLY === '1',

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