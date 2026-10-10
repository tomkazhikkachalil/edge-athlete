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

  // The scorer's hole header (hole-detail program, Oct 2026).
  GOLF_HOLE: {
    TO_GREEN: (yds: number) => `${yds} yds to green`,
    /** M2: front / centre / back of the green from a GPS fix with an outline. */
    FCB: (front: number, centre: number, back: number) => `F ${front} · C ${centre} · B ${back}`,
    TEE_TO_GREEN: (yds: number) => `Tee → green ${yds} yds`,
    PLAYS_LIKE: (yds: number) => `plays like ≈${yds}`,
    PLAYS_LIKE_WORD: 'plays like',
    THRU: (n: number) => `thru ${n}`,
    TEE_IN_PLAY: 'playing',
    OPEN_MAP_ON: (hole: number) => `Open the map on hole ${hole}`,
    // M1: the explicit Follow toggle and the first-hole control.
    FOLLOW_ME: 'Follow me',
    FOLLOW_ON: 'Stop following my position',
    FOLLOW_OFF: 'Follow my position',
    // The visible word is never "Hole N": the e2e idiom `getByText(/^Hole N\b/)`
    // is strict and must keep resolving to the chip alone.
    FIRST_HOLE: 'First hole',
    FIRST_HOLE_LABEL: (n: number) => `Go to the first hole (hole ${n})`,
    FIRST_HOLE_UNMAPPED: (n: number) => `Hole ${n} has no map line — the chip moves, the map stays`,
    NOT_MAPPED: 'Not mapped yet',
    // Sweep PR 3: the greens-only tier.
    NEAREST_GREEN: 'Nearest green',
    GREENS_ONLY: 'Greens only',
    // Sweep PR 4: pickable nines.
    PICK_NINE: 'Pick a nine',
    WHICH_NINE: 'Which nine?',
    FRONT_NINE: 'Front',
    BACK_NINE: 'Back',
    NINE: (label: string) => `Nine ${label}`,
    // Sweep PR 5: lines synthesised from numbered tees / fairways / greens.
    DERIVED_NOTE: 'Mapped from tees and greens',
  },

  // The course summary card (course flow fixes M3, Oct 2026).
  GOLF_COURSE: {
    VIEW_MAP: 'View course map',
    NOT_FULLY_MAPPED: 'Not fully mapped',
    HOLES: (n: number) => `${n} holes`,
    PAR: (n: number) => `Par ${n}`,
    GAP_NO_HOLE_DATA: 'No hole-by-hole data',
    GAP_NO_YARDAGE: (tee: string) => `No yardage for the ${tee} tee`,
    GAP_NO_LINES: 'No map lines',
    GAP_GREENS_ONLY: 'Greens only — nearest-green distances',
    GAP_PICK_NINE: (n: number) => `${n} nines mapped — pick one on the map`,
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
    // Results-kept round (241, Tom: "hide only, no delete"): a round anyone
    // scored, an event post or a stat line is HIDDEN from your profile — it
    // stays on the record and keeps counting. Only an unplayed round deletes.
    HIDE_RESULT_TITLE: 'Hide from your profile?',
    HIDE_RESULT_CONFIRM:
      'It leaves the feed and nobody else sees it on your profile, but it stays on the record — it still counts toward your stats and handicap. You can show it again from your own profile or Settings → Privacy.',
    HIDE_ROUND_CONFIRM_PARTNERS: (n: number) =>
      `It leaves the feed and nobody else sees it on your profile, but it stays on the record — your scores still count, and your ${n === 1 ? 'playing partner keeps theirs' : `${n} playing partners keep theirs`}. You can show it again from your own profile or Settings → Privacy.`,
    HIDE_RESULT_ACTION: 'Hide',
    HIDE_RESULT_LABEL: 'Hide from profile',
    // A REAL delete (Tom, Oct 2 2026): a result that is not from a tournament,
    // a club or a league may be deleted by its player — it stops counting.
    // An unfinished casual round is discarded whole: nothing was recorded.
    DISCARD_ROUND_CONFIRM:
      'The round and every score entered so far are deleted. Nothing is recorded, and this cannot be undone.',
    DISCARD_ROUND_CONFIRM_PARTNERS: (n: number) =>
      `The round is deleted for everyone in it — including scores entered by ${n} playing partner${n === 1 ? '' : 's'}. Nothing is recorded, and this cannot be undone.`,
    DELETE_RESULT_LABEL: 'Delete for good',
    DELETE_RESULT_TITLE: 'Delete it for good?',
    DELETE_RESULT_CONFIRM:
      'It is removed everywhere and stops counting toward your handicap and stats. This cannot be undone. To keep the numbers and only take it off your profile, choose Hide instead.',
    DELETE_RESULT_CONFIRM_PARTNERS: (n: number) =>
      `Your result is removed and stops counting toward your handicap and stats, and the round’s post goes with it. Your ${n === 1 ? 'playing partner keeps theirs' : `${n} playing partners keep theirs`}. This cannot be undone.`,
    DELETE_RESULT_ACTION: 'Delete for good',
    DELETED_RESULT_TITLE: 'Deleted',
    DELETED_RESULT_BODY: 'It no longer counts toward your handicap or stats.',
    // The way back, on the owner's own profile (Oct 2026).
    PROFILE_HIDDEN_BANNER: 'Hidden from your profile — only you can see this. It still counts toward your stats.',
    SHOW_RESULT_LABEL: 'Show on profile',
    SHOWN_AGAIN_TITLE: 'Back on your profile',
    SHOWN_AGAIN_BODY: 'Everyone who can see your profile can see it again.',
    // Drafts (253): recorded, not yet posted — the owner sees it on the
    // review screen and in Drafts; the round's players on the live page.
    DRAFT_BANNER: 'Not posted yet — only you and the people playing can see this.',
    DRAFT_IN_PROGRESS_BANNER: 'Still being played — it will be a draft once the round is finished.',
    REVIEW_DRAFT_LABEL: 'Review and post',
    FINISH_ROUND_TITLE: 'Finish this round?',
    FINISH_ROUND_CONFIRM: 'The round is recorded as played — scores can still be fixed afterwards. Nothing is posted until you tap Post on the review screen.',
    FINISH_ROUND_ACTION: 'Finish round',
    REOPEN_TITLE: 'Pick up where you left off?',
    // Discard from the prompt is destructive — it is confirmed, and the
    // confirm says what goes (Tom, Oct 7 2026, from his phone).
    REOPEN_DISCARD_TITLE: 'Discard this?',
    REOPEN_DISCARD_ROUND_SCORED: 'The round and every score entered so far are deleted. Nothing is recorded, and this cannot be undone.',
    REOPEN_DISCARD_ROUND_EMPTY: 'The round is deleted. Nothing was recorded, and this cannot be undone.',
    REOPEN_DISCARD_WORKOUT: 'The workout and every set entered so far are deleted. This cannot be undone.',
    REOPEN_DISCARD_RECORDING: 'The recording on this phone is deleted. Nothing was saved, and this cannot be undone.',
    REOPEN_DISCARD_ACTION: 'Discard for good',
    REOPEN_BODY: 'Closing the app never ends anything. Resume to keep going, Finish to record it as it stands, or Discard it. You can also find it under Drafts.',
    POST_DRAFT_LABEL: 'Post',
    POSTED_TITLE: 'Posted',
    POSTED_BODY: 'It is on the feed and your profile now.',
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
    DANGER_ZONE: 'Deleting your account hides it now and deletes it after 30 days. Results you recorded with other people stay under your name.',
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

  // Who sees what you post (Oct 9 2026, Tom): the ACCOUNT decides — a public
  // account, anyone; a private one, your approved fans. Per item the only
  // choice is Post it or Only me. Never a per-post "followers only".
  // src/lib/posts/audience.ts reads these.
  AUDIENCE: {
    QUESTION: 'Who sees it?',
    POST_IT: 'Post it',
    ONLY_ME: 'Only me',
    WHO_PUBLIC: 'Anyone can see it — on the feed and your profile',
    WHO_PRIVATE: 'Only your approved fans can see it — your account is private',
    ONLY_ME_LINE: 'Not on the feed — only you can see it',
    LEGACY_FANS_ONLY: 'Only your fans see this post',
    CHANGE: 'Change',
  },

  // Download the app (Oct 2026) — the web app installed from the browser,
  // no store. One platform rule decides which steps a device is shown
  // (src/lib/install/platform.ts); the limits named here are Apple's and
  // Google's, said plainly.
  // The offline banner (maintenance pass, Oct 10 2026).
  NETWORK: {
    OFFLINE: "You're offline. What you record or write is saved on this device and sends when you're back.",
    BACK_ONLINE: 'Back online',
  },
  INSTALL: {
    MENU: 'Get the app',
    CTA: 'Download the app',
    SHOW_STEPS: 'Show me how',
    SHEET_TITLE: 'Get the Edge Athlete app',
    SHEET_SUBTITLE: 'An icon on your phone. No app store.',
    CARD_TITLE: 'Get the Edge Athlete app',
    CARD_BODY: 'Put Edge Athlete on your home screen. It opens full screen, like any app.',
    CARD_DISMISS: 'Dismiss the app invitation',
    SETTINGS_TITLE: 'Edge Athlete app',
    SETTINGS_BODY: 'Add Edge Athlete to your home screen. It opens full screen like any app, with everything you have here.',
    USING_APP: "You're using the Edge Athlete app.",
    INSTALLED_HERE: 'Edge Athlete is installed on this device. Open it from your home screen.',
    SAME_APP: 'It is the full Edge Athlete: the same account and every feature.',
    SIGN_IN_ONCE: "You'll sign in once inside the app.",
    PROMPT_BODY: 'One tap, and the Edge Athlete icon appears on your home screen.',
    PROMPT_BUTTON: 'Install Edge Athlete',
    IOS_SAFARI_STEPS: [
      'Tap the Share button at the bottom of Safari.',
      'Scroll down and tap "Add to Home Screen".',
      'Tap "Add" in the top corner.',
    ],
    IOS_BROWSER_STEPS: [
      'Tap the Share button beside the address bar.',
      'Tap "Add to Home Screen".',
      'Tap "Add".',
    ],
    IOS_BROWSER_NOTE: (host: string) =>
      `No "Add to Home Screen" in the list? Open ${host} in Safari and follow the same steps there.`,
    ANDROID_MENU_STEPS: [
      'Tap the menu (three dots) at the top of your browser.',
      'Tap "Install app" or "Add to Home screen".',
      'Tap "Install".',
    ],
    IN_APP_BODY: "You're inside another app's browser, and it can't add apps to a phone.",
    IN_APP_STEPS: (browser: string, host: string) => [
      `Open ${host} in ${browser}. This screen's menu usually has "Open in ${browser}".`,
      'Sign in there.',
      'Tap "Download the app".',
    ],
    COPY_LINK: 'Copy the link',
    LINK_COPIED: 'Link copied',
    DESKTOP_BODY: (host: string) =>
      `The app is for a phone or tablet. On your phone, open ${host}, sign in and tap "Download the app".`,
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