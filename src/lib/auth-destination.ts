// ── Where a freshly signed-in account goes (Nov 2 2026) — pure, ZERO imports ─
// The OAuth callback decided this inline since July; the e-mail confirmation
// link (`/auth/confirm`, Convention 56) needs the same answer, so the rule
// lives here and both routes import it. One reading of "where next":
//   no profile row      → complete-profile (OAuth first-timers pick a handle)
//   parent (097)        → the guardian console, or add-athlete first
//   organizer (178)     → the feed, or the club wizard first — never the athlete wizard
//   scout (182)         → the scouting area (its wizard is the sign-up itself)
//   everyone else       → the profile, or onboarding first

export interface DestinationProfile {
  onboarded_at: string | null;
  user_type: string | null;
}

export const COMPLETE_PROFILE_PATH = '/auth/complete-profile';

export function destinationFor(profile: DestinationProfile | null | undefined): string {
  if (!profile) return COMPLETE_PROFILE_PATH;
  const done = Boolean(profile.onboarded_at);
  switch (profile.user_type) {
    case 'parent': return done ? '/app/guardian' : '/app/guardian/add-athlete';
    case 'organizer': return done ? '/feed' : '/club/start';
    case 'scout': return '/app/scout';
    default: return done ? '/athlete' : '/onboarding';
  }
}

/** The account types whose "onboarding" is the sign-up form itself: the
 *  confirmation route stamps `onboarded_at` for them, the way the sign-up
 *  form did right after its automatic sign-in while confirmations were off. */
export function stampsOnboardingOnConfirm(userType: string | null | undefined): boolean {
  return userType === 'scout' || userType === 'organizer';
}
