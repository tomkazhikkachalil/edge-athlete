/**
 * What an auth event means for the app (Oct 2026 speed round). Pure, zero
 * imports — the AuthProvider's one decision, unit-tested.
 *
 * Supabase announces far more than sign-ins: TOKEN_REFRESHED every time the
 * access token is renewed (the provider's 15-minute timer, and on the spot
 * when a phone reopens the installed app after a while), SIGNED_IN again when
 * a tab regains focus, INITIAL_SESSION once at boot beside the provider's own
 * boot read. Each used to hand React a NEW user object and re-read the
 * profile, so every effect keyed on `user` across the app re-ran: the feed
 * dropped to its skeleton and reloaded, the bell refetched and resubscribed,
 * the inbox reloaded. Measured on production: one token refresh = the feed
 * reloaded once, /api/notifications four times, the profile once.
 *
 * The rule: the SAME person stays the same object, and their profile is read
 * once per person, not once per event. A different person, a sign-out, or an
 * update to the account itself (USER_UPDATED) still changes everything.
 */

export interface AuthEventPlan {
  /** Clear the session state (signed out). */
  clear: boolean;
  /** Keep the current user object (same person) — no re-render storm. */
  keepUser: boolean;
  /** Read the profile. */
  fetchProfile: boolean;
}

export function planAuthEvent(input: {
  event: string;
  currentUserId: string | null;
  nextUserId: string | null;
  /** The user id whose profile read has already been STARTED (by the boot
   *  path or an earlier event). */
  profileRequestedFor: string | null;
}): AuthEventPlan {
  const { event, currentUserId, nextUserId, profileRequestedFor } = input;
  if (event === 'SIGNED_OUT' || nextUserId === null) {
    return { clear: true, keepUser: false, fetchProfile: false };
  }
  const samePerson = currentUserId !== null && currentUserId === nextUserId;
  if (event === 'USER_UPDATED') {
    // The account itself changed (email, metadata): new object, fresh profile.
    return { clear: false, keepUser: false, fetchProfile: true };
  }
  return {
    clear: false,
    keepUser: samePerson,
    fetchProfile: profileRequestedFor !== nextUserId,
  };
}
