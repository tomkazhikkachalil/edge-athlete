// ── The signup user_type decision, as a pure seam ───────────────────────────
// /api/signup used to trust profileData.user_type from the CLIENT, and the
// 097 CHECK allows 'club'/'league'/'parent' — so anyone could self-assign an
// org type by posting it (found in the org-signup round, Aug 24). Org types
// are provisioned through their own flows (parent via actorRole; leagues via
// the request+approve queue), never self-assigned at signup.
//
// Mirrors SELF_SERVICE_USER_TYPES in src/app/api/profile/route.ts.

const SELF_SERVICE_SIGNUP_TYPES = ['athlete', 'fan'] as const;
type SelfServiceType = (typeof SELF_SERVICE_SIGNUP_TYPES)[number];

export function resolveSignupUserType(
  actorRole: string,
  requested: unknown
): 'parent' | SelfServiceType {
  if (actorRole === 'guardian') return 'parent';
  return (SELF_SERVICE_SIGNUP_TYPES as readonly string[]).includes(requested as string)
    ? (requested as SelfServiceType)
    : 'athlete';
}
