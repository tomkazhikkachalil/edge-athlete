// ── The signup user_type decision, as a pure seam ───────────────────────────
// /api/signup used to trust profileData.user_type from the CLIENT, and the
// 097 CHECK allows 'club'/'league'/'parent' — so anyone could self-assign an
// org type by posting it (found in the org-signup round, Aug 24). Org types
// are provisioned through their own flows (parent via actorRole; leagues via
// the request+approve queue), never self-assigned at signup.
//
// Mirrors SELF_SERVICE_USER_TYPES in src/app/api/profile/route.ts.
//
// Org staff program (Sep 4 2026, mig 178): the ORGANIZER actor — the org
// "master account" — gets user_type 'organizer' the same way a guardian
// actor gets 'parent': decided by the actor branch, never by the requested
// value. Organizers have no date of birth (adult assumed — Tom's decision)
// and never enter the athlete onboarding.

const SELF_SERVICE_SIGNUP_TYPES = ['athlete', 'fan'] as const;
type SelfServiceType = (typeof SELF_SERVICE_SIGNUP_TYPES)[number];

export type SignupActorRole = 'athlete' | 'guardian' | 'organizer';

/** The actorRole contract shared by /api/signup and /api/auth/complete-
 *  profile: anything but the two privileged actors is an athlete. */
export function resolveSignupActorRole(raw: unknown): SignupActorRole {
  return raw === 'guardian' || raw === 'organizer' ? raw : 'athlete';
}

export function resolveSignupUserType(
  actorRole: string,
  requested: unknown
): 'parent' | 'organizer' | SelfServiceType {
  if (actorRole === 'guardian') return 'parent';
  if (actorRole === 'organizer') return 'organizer';
  return (SELF_SERVICE_SIGNUP_TYPES as readonly string[]).includes(requested as string)
    ? (requested as SelfServiceType)
    : 'athlete';
}
