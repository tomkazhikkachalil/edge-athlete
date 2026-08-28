// Pure authorization resolver for profile-scoped actions (guardian-profiles
// feature). No I/O — the matrix below IS the spec and the test fixture.
// The DB-aware wrapper (requireProfileRole) lives in auth-server.ts.
//
// Enforcement context: the vast majority of API routes (133 of 151 as of
// Aug 2026) use the service-role client, so RLS is bypassed on the main HTTP
// surface — THIS layer is the primary gate. RLS (has_profile_access) is
// defense-in-depth; the UI only reflects it. A CI test
// (src/lib/__tests__/api-route-authz.test.ts) enumerates every route and
// fails the build if a handler has no declared gate or allowlist entry.

export type ProfileRole = 'owner' | 'guardian' | 'supervised' | 'viewer';

export type ProfileAction =
  | 'read'
  | 'write_content'
  | 'publish_content'
  | 'approve_content'
  | 'manage_settings'
  | 'manage_privacy'
  | 'manage_access'
  | 'delete_profile'
  | 'initiate_transfer';

// role → allowed actions. 'read' for role null falls through to
// canViewProfile (public/follower visibility) — not this resolver's job.
// Caveats enforced at the RPC/route layer (they need DB state):
//   - guardian manage_access: cannot remove the last guardian of a
//     supervised profile; cannot self-elevate.
//   - guardian delete_profile: consent-withdrawal path only.
//   - supervised write_content: writes are forced to status='pending_approval'.
//   - supervised initiate_transfer: creates a *request* needing guardian
//     approval, never executes directly.
const MATRIX: Record<ProfileRole, ReadonlySet<ProfileAction>> = {
  owner: new Set<ProfileAction>([
    'read', 'write_content', 'publish_content', 'approve_content',
    'manage_settings', 'manage_privacy', 'manage_access', 'delete_profile',
  ]),
  guardian: new Set<ProfileAction>([
    'read', 'write_content', 'publish_content', 'approve_content',
    'manage_settings', 'manage_privacy', 'manage_access', 'delete_profile',
    'initiate_transfer',
  ]),
  supervised: new Set<ProfileAction>([
    'read', 'write_content', 'initiate_transfer',
  ]),
  viewer: new Set<ProfileAction>(['read']),
};

export function resolveProfileAction(
  role: ProfileRole | null | undefined,
  action: ProfileAction
): boolean {
  if (!role) return false;
  return MATRIX[role].has(action);
}
