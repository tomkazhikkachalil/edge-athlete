/**
 * Centralized Copy Management
 * 
 * All user-facing text, labels, messages, and copy in one place.
 * Enables consistent messaging and easy updates when enabling new sports.
 */

import type { SportKey } from './sports/SportRegistry';
import { getSportDefinition } from './sports/SportRegistry';

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
  },

  // Error Messages
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
    ADD_TWITTER: 'Add Twitter',
    ADD_INSTAGRAM: 'Add Instagram',
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

  // Feature-Specific Copy
  FEATURES: {
    GOLF: {
      HANDICAP_HELP: 'Official USGA Handicap Index',
      TEE_PREFERENCES: {
        black: 'Black (Championship)',
        blue: 'Blue (Back/Tips)',
        white: 'White (Men\'s Regular)',
        red: 'Red (Forward/Ladies)',
        gold: 'Gold (Senior)',
      },
      DOMINANT_HAND: {
        right: 'Right-handed',
        left: 'Left-handed',
      },
    },
    HOCKEY: {
      COMING_SOON: 'Hockey stats and equipment tracking coming soon!',
    },
    VOLLEYBALL: {
      COMING_SOON: 'Volleyball performance metrics coming soon!',
    },
  },

  // Route Information (for debugging/development)
  ROUTES: {
    PUBLIC_PROFILE: (username: string) => `/u/${username}`,
    PRIVATE_PROFILE: '/app/profile',
    SPORT_ACTIVITY: (sportKey: SportKey, activityId: string) => `/app/sport/${sportKey}/activity/${activityId}`,
    GOLF_ROUND: (roundId: string) => `/app/sport/golf/rounds/${roundId}`,
  },
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

/**
 * Get sport-specific route
 */
export function getSportRoute(sportKey: SportKey, activityId: string): string {
  if (sportKey === 'golf') {
    return COPY.ROUTES.GOLF_ROUND(activityId);
  }
  return COPY.ROUTES.SPORT_ACTIVITY(sportKey, activityId);
}

// Export specific sections for easy importing
export const copy = COPY;
export { COPY as COPY_CONFIG };