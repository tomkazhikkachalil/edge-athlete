/**
 * Centralized Copy Management
 * 
 * All user-facing text, labels, messages, and copy in one place.
 * Enables consistent messaging and easy updates when enabling new sports.
 */

import type { SportKey } from './sports/SportRegistry';
import { getSportDefinition } from './sports/SportRegistry';
// NOTHING ELSE from src/lib/sports may be imported here at runtime.
// SportAdapter.ts imports getComingSoonMessage from this file, so any runtime
// import back into the sports layer closes a cycle: copy → AdapterRegistry →
// GolfAdapter → SportAdapter → copy. Whichever module the bundler evaluates
// first then reads a half-initialised binding, and the page dies with
// "Cannot access 'BaseSportAdapter' before initialization". A type-only
// import is fine — it is erased. See DEVLOG 2026-08-12.

// Global Copy Constants
export const COPY = {
  // Coming Soon Messages
  COMING_SOON: {
    SPORT_GENERAL: 'Coming soon',
    SPORT_SETTINGS: (sportName: string) => `${sportName} preferences coming soon!`,
    SPORT_ACTIVITY: (sportName: string) => `${sportName} activity tracking coming soon!`,
    SPORT_EDITING: (sportName: string) => `${sportName} editing coming soon!`,
    SPORT_DELETION: (sportName: string) => `${sportName} deletion coming soon!`,
    PUBLIC_PROFILES: 'Public athlete profiles are coming soon!',
    FEATURE_GENERAL: (featureName: string) => `${featureName} feature coming soon!`,
  },

  // Empty States
  EMPTY_STATES: {
    NO_PERFORMANCES: 'No performances recorded yet',
    NO_HIGHLIGHTS: 'Add your achievements to showcase your progress!',
    NO_ACTIVITY: (sportName: string) => `No ${sportName.toLowerCase()} activity yet`,
    NO_ACHIEVEMENTS: 'No achievements earned yet',
    PERFORMANCE_ENCOURAGEMENT: 'Add your competition results to track progress!',
    ACTIVITY_ENCOURAGEMENT: (activityType: string) => `Add your ${activityType.toLowerCase()} to track progress!`,
  },

  // Button Labels
  BUTTONS: {
    ADD_PERFORMANCE: 'Add Performance',
    EDIT_PROFILE: 'Edit Profile',
    SIGN_OUT: 'Sign Out',
    SAVE_CHANGES: 'Save Changes',
    CANCEL: 'Cancel',
    DELETE: 'Delete',
    EDIT: 'Edit',
    VIEW_DETAILS: 'View Details',
    GO_BACK: 'Go Back',
    TRY_AGAIN: 'Try Again',
  },

  // Sport-Specific Actions
  SPORT_ACTIONS: {
    PRIMARY_ACTION: (sportKey: SportKey): string => {
      const sportDef = getSportDefinition(sportKey);
      return sportDef.primary_action;
    },
    VIEW_ACTIVITY: (sportKey: SportKey): string => {
      const sportDef = getSportDefinition(sportKey);
      const activityType = sportDef.activity_columns.col2.slice(0, -1); // Remove 's' from plural
      return `View ${activityType} Details`;
    },
    EDIT_ACTIVITY: (sportKey: SportKey): string => {
      const sportDef = getSportDefinition(sportKey);
      const activityType = sportDef.activity_columns.col2.slice(0, -1);
      return `Edit ${activityType}`;
    },
    DELETE_ACTIVITY: (sportKey: SportKey): string => {
      const sportDef = getSportDefinition(sportKey);
      const activityType = sportDef.activity_columns.col2.slice(0, -1);
      return `Delete ${activityType}`;
    },
  },

  // Navigation Labels
  NAVIGATION: {
    RECENT_ACTIVITY: 'Recent Activity',
    SPORT_HIGHLIGHTS: 'Sport Highlights',
    SEASON_HIGHLIGHTS: 'Season Highlights',
    PROFILE_SETTINGS: 'Profile Settings',
    BACK_TO_ACTIVITY: 'Back to Activity',
    BACK_TO_PROFILE: 'Back to Profile',
  },

  // Sort & Filter Labels
  SORTING: {
    NEWEST_OLDEST: 'Newest → Oldest',
    SORT_INDICATOR: 'Sorted newest to oldest',
    DATE_COLUMN_TITLE: 'Newest → Oldest',
  },

  // Status Messages
  STATUS: {
    LOADING: 'Loading...',
    SAVING: 'Saving...',
    SAVED: 'Saved!',
    ERROR: 'Error occurred',
    SUCCESS: (action: string) => `${action} successful!`,
    AUTHENTICATING: 'Authenticating...',
    LOADING_PROFILE: 'Loading profile...',
    LOADING_ACTIVITY: 'Loading activity...',
  },

  // Form Labels
  FORMS: {
    REQUIRED_FIELD: 'This field is required',
    INVALID_INPUT: 'Please enter a valid value',
    SAVE_SUCCESS: (itemType: string) => `${itemType} saved successfully!`,
    DELETE_SUCCESS: (itemType: string) => `${itemType} deleted successfully!`,
    DELETE_CONFIRM: (itemType: string) => `Are you sure you want to delete this ${itemType.toLowerCase()}? This action cannot be undone.`,
    DISCARD_TITLE: 'Discard changes?',
    DISCARD_CONFIRM: "You have unsaved changes. If you close now, they'll be lost.",
    DISCARD_ACTION: 'Discard',
    KEEP_EDITING: 'Keep editing',
    // Round deletion is TOTAL — group post, scorecard, scores, feed post and
    // stat mirrors all go (Tom's call, Aug 19: a round's post IS the round).
    DELETE_ROUND_TITLE: 'Delete this round?',
    DELETE_ROUND_CONFIRM:
      'The round, its scorecard, and its post will be permanently deleted. This cannot be undone.',
    DELETE_ROUND_CONFIRM_PARTNERS: (n: number) =>
      `The round, its scorecard, and its post will be permanently deleted — including scores entered by ${n} playing partner${n === 1 ? '' : 's'}. This cannot be undone.`,
    DELETE_ROUND_ACTION: 'Delete Round',
  },

  // Error Messages
  // Departed accounts (Sep 24 2026, Tom): an adult's results outlive the
  // person — they stay with the club, league or event under the person's
  // name. A supervised athlete follows the consent their guardian signed.
  ACCOUNT: {
    DELETE_TITLE: 'Your account will be deleted in 30 days',
    DELETE_BODY: 'Your account is hidden now and deleted after 30 days. Sign back in before then to restore it; after that it cannot be undone.',
    DELETE_GOES_TITLE: 'What is deleted',
    DELETE_GOES: [
      'Your profile, login and personal details',
      'Posts, photos and videos you shared on your profile',
      'Your comments, likes and saved posts',
      'Your followers, following and messages',
      'Your notifications and activity history',
      'Rounds you played on your own, and your sport settings',
    ],
    DELETE_STAYS_TITLE: 'What stays',
    DELETE_STAYS: 'Results you recorded with other people — a club or league competition, an event, a round you played with others — stay part of those records under your name, the way a printed results sheet would. Other players\' results never change because you left.',
    DELETE_FINAL: 'After 30 days your account is deleted and cannot be restored.',
    BANNER_STAYS: 'Results you recorded with a club, league, event or other players will stay under your name.',
    GOODBYE_TITLE: 'Your account is scheduled for deletion',
    GOODBYE_BODY: 'It is hidden now and will be deleted in 30 days. Sign back in before then to restore it.',
    MINOR_V2: 'Withdrawing consent permanently deletes this athlete\'s profile and all of its content, including results, after a 30-day window in which you can restore it.',
    MINOR_V3: 'Withdrawing consent permanently deletes this athlete\'s profile and its content after a 30-day window in which you can restore it. Results recorded with other players stay part of those records under the name "Athlete", so no one else\'s results change.',
    DEPARTED_PAGE: 'This account is no longer on Edge Athlete.',
    DEPARTED_DM: 'This person is no longer on Edge Athlete.',
  },

  // Support & Reporting, Spec 2: the words the report sheet speaks.
  SUPPORT: {
    REPORT_TITLE: 'Report',
    REPORT_INTRO: 'Reports are reviewed by the Edge Athlete team. The person you report is never told who reported them.',
    REPORT_DONE_TITLE: 'Report sent',
    REPORT_DONE_BODY: 'Thanks — our team will review it. You can follow it under Settings → Support.',
    BLOCK_OFFER: 'Block',
    BLOCK_HINT: 'They can no longer follow, message or tag you. Immediate.',
    MUTE_OFFER: 'Mute',
    MUTE_HINT: 'Their posts and comments leave your view. They are not told.',
    // Tom to confirm the resource (Sep 20 2026): 9-8-8 is Canada's national suicide crisis line.
    CRISIS_TITLE: 'If someone is in danger right now',
    CRISIS_BODY: 'Call or text 9-8-8 (Talk Suicide Canada) — free, confidential, 24/7. Outside Canada, contact your local emergency number.',
    // The Help Center's Contact card (Spec 3). Tom to confirm the details to show (name + email; phone was an open question).
    CONTACT_NAME: 'Tom Kazhikkachalil',
    CONTACT_ROLE: 'Founder, Edge Athlete',
    CONTACT_EMAIL: 'support@edgeathlete.ca',
    CONTACT_NOTE: 'The fastest way to reach us is a request above — it gets a ticket number and a reply here and by email. Email is the fallback.',
  },
  ERRORS: {
    PROFILE_NOT_FOUND: 'Profile not found',
    ACTIVITY_NOT_FOUND: 'Activity not found',
    ACCESS_DENIED: 'You don\'t have access to this content',
    GENERIC_ERROR: 'Something went wrong. Please try again.',
    NETWORK_ERROR: 'Network error. Please check your connection.',
    AUTH_REQUIRED: 'Please log in to continue',
  },

  // Tabs & Sections
  TABS: {
    BASIC: 'Basic',
    VITALS: 'Vitals',
    SOCIALS: 'Socials',
    EQUIPMENT: 'Equipment',
    SPORT_TAB: (sportName: string) => sportName,
    COMING_SOON_INDICATOR: '(Soon)',
  },

  // Placeholders
  PLACEHOLDERS: {
    ADD_BIO: 'Click to add your bio',
    NO_HEIGHT: 'Add height',
    NO_WEIGHT: 'Add weight',
    NO_LOCATION: 'Add location',
    NO_CLASS_YEAR: 'Add class year',
    ADD_TWITTER: 'Add X',
    ADD_INSTAGRAM: 'Add Instagram',
    ADD_TIKTOK: 'Add TikTok',
    ADD_FACEBOOK: 'Add Facebook',
    EMPTY_VALUE: '—',
  },

  // Activity Column Headers (Dynamic based on sport)
  ACTIVITY_HEADERS: {
    DATE: 'Date',
    ACTIONS: 'Actions',
    // Sport-specific headers come from SportRegistry
  },

  // Toast Messages
  TOASTS: {
    PROFILE_UPDATED: 'Profile updated successfully!',
    PERFORMANCE_ADDED: 'Performance added successfully!',
    PERFORMANCE_UPDATED: 'Performance updated successfully!',
    PERFORMANCE_DELETED: 'Performance deleted successfully!',
    HIGHLIGHTS_UPDATED: 'Season highlights updated successfully!',
    SETTINGS_SAVED: (category: string) => `${category} settings saved successfully!`,
    GENERIC_SUCCESS: 'Changes saved successfully!',
    GENERIC_ERROR: 'Failed to save changes',
  },

  // FEATURES (per-sport label sets) and ROUTES were deleted August 2026:
  // zero consumers. Sport-specific field labels live in
  // src/lib/sports/settings-schemas.ts; sport activity routing goes through
  // SportAdapter.getActivityHref().
} as const;

// Helper functions for dynamic copy generation

/**
 * Get coming soon message for a specific sport
 */
export function getComingSoonMessage(sportKey: SportKey, context: 'settings' | 'activity' | 'editing' | 'deletion' = 'activity'): string {
  const sportDef = getSportDefinition(sportKey);
  
  switch (context) {
    case 'settings':
      return COPY.COMING_SOON.SPORT_SETTINGS(sportDef.display_name);
    case 'activity':
      return COPY.COMING_SOON.SPORT_ACTIVITY(sportDef.display_name);
    case 'editing':
      return COPY.COMING_SOON.SPORT_EDITING(sportDef.display_name);
    case 'deletion':
      return COPY.COMING_SOON.SPORT_DELETION(sportDef.display_name);
    default:
      return COPY.COMING_SOON.SPORT_GENERAL;
  }
}

/**
 * Get empty state message for a specific sport
 */
export function getEmptyStateMessage(sportKey: SportKey): string {
  const sportDef = getSportDefinition(sportKey);
  return COPY.EMPTY_STATES.NO_ACTIVITY(sportDef.display_name);
}

/**
 * Get encouragement message for adding activity
 */
export function getActivityEncouragement(sportKey: SportKey): string {
  const sportDef = getSportDefinition(sportKey);
  const activityType = sportDef.activity_columns.col2.toLowerCase(); // "rounds", "games", "matches"
  return COPY.EMPTY_STATES.ACTIVITY_ENCOURAGEMENT(activityType);
}

// getSportRoute() lived here and dispatched through getSportAdapter(). It had
// ZERO callers repo-wide, and its doc comment asserted an invariant that had
// since become false ("nothing under src/lib/sports imports copy.ts" —
// SportAdapter.ts does). That single import was the whole cycle, so the dead
// function is gone rather than reshuffled. If a sport-aware route helper is
// wanted again, put it under src/lib/sports, never here.

// Export specific sections for easy importing
export const copy = COPY;
export { COPY as COPY_CONFIG };