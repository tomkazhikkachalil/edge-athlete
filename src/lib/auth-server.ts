import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient, type User } from '@supabase/supabase-js';
import { parseCookieHeader } from './cookies';
import {
  resolveProfileAction,
  type ProfileAction,
  type ProfileRole,
} from './profile-roles';

/**
 * Creates a Supabase admin client (service role) on demand.
 * MUST be called inside request handlers, never at module scope,
 * to avoid build failures when env vars aren't available during static analysis.
 */
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The single cookie-scoped Supabase server client for API routes.
 * Queries made through it run under the authenticated user's RLS policies.
 *
 * This replaces the hand-rolled `createServerClient(...)` + cookie-split that
 * was copy-pasted into ~19 route files — one correct cookie parser instead of
 * nineteen. `requireAuth` and `getServerAuth` both build on it.
 */
export function getServerClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return [];
          return Object.entries(parseCookieHeader(cookieHeader)).map(
            ([name, value]) => ({ name, value })
          );
        },
        setAll() {
          // Not used in API routes - cookies are set client-side
        },
      },
    }
  );
}

/**
 * Non-throwing auth for routes that return their own 401. Gives back both the
 * user (nullable) and the cookie-scoped RLS client for subsequent queries.
 */
export async function getServerAuth(request: NextRequest) {
  const supabase = getServerClient(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user, error };
}

export async function requireAuth(request: NextRequest) {
  try {
    // Get the authenticated user via the shared cookie-scoped client
    const supabase = getServerClient(request);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return user;
  } catch (err) {
    if (err instanceof Response) {
      throw err;
    }
    throw new Response(
      JSON.stringify({ error: 'Authentication failed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Resolve the caller's role on a target profile (guardian-profiles feature).
 *
 * DELIBERATELY NOT flag-gated (Family Console Wave 1): the role lookup is a
 * safety primitive, not a feature surface. The old flag fast-path returned
 * 'owner' for self with the flag off, which silently disabled the
 * supervised-pending pipeline — a flag flip would have published minors'
 * content. FEATURE_GUARDIAN_PROFILES now only hides feature SURFACES
 * (guardian pages/funnels); everything role- or status-driven runs
 * unconditionally. profile_access exists since migration 048; migrations are
 * the schema source of truth.
 *
 * The role comes from profile_access: the self row may be 'supervised'
 * (minor with their own login), and non-self users may hold guardian/viewer
 * rows.
 */
export async function getProfileRole(
  userId: string,
  profileId: string
): Promise<ProfileRole | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('profile_access')
    .select('role')
    .eq('user_id', userId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    console.error('[AUTHZ] profile_access lookup failed:', error);
    // Fail closed for cross-profile access; preserve self-access so a
    // transient DB error can't lock owners out of their own profile.
    return userId === profileId ? 'owner' : null;
  }
  return (data?.role as ProfileRole) ?? null;
}

/**
 * Primary server-side authorization gate for profile-scoped actions.
 * Throws a Response (401/403) in the requireAuth style. RLS is defense-in-
 * depth only — the vast majority of routes (133 of 151 as of Aug 2026) use
 * the admin client, which bypasses it.
 */
export async function requireProfileRole(
  request: NextRequest,
  profileId: string,
  action: ProfileAction
): Promise<{ user: User; role: ProfileRole }> {
  const user = await requireAuth(request);
  const role = await getProfileRole(user.id, profileId);
  if (!role || !resolveProfileAction(role, action)) {
    throw new Response(
      JSON.stringify({ error: 'You do not have permission to perform this action on this profile' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return { user, role };
}

/**
 * Gate for HOUSEHOLD-scoped guardian surfaces (Wave 4) — routes with no
 * profileId to role-check (household policy, apply-to-all, household
 * blocks). Session + at least one profile_access guardian row, else 403.
 *
 * Returns the athleteIds every household loop must scope to: supervised,
 * non-parked children only. A transferred child's guardian row became
 * 'viewer' and a parked child is restore-only, so both exit household scope
 * by construction — policy features need zero cleanup on either transition.
 *
 * Throws a Response (401/403) in the requireAuth style.
 */
export async function requireGuardianAccount(
  request: NextRequest,
  // Wave 8: read-only surfaces opt in with ['guardian','viewer'] so a
  // view-only seat can see household state; every WRITE route keeps the
  // default — viewers must never pass an action gate.
  roles: Array<'guardian' | 'viewer'> = ['guardian']
): Promise<{ user: User; athleteIds: string[] }> {
  const user = await requireAuth(request);
  const admin = getSupabaseAdmin();
  const { data: rows } = await admin
    .from('profile_access')
    .select('profiles!profile_access_profile_id_fkey(id, supervision_state, deletion_requested_at)')
    .eq('user_id', user.id)
    .in('role', roles);
  const athleteIds = (rows ?? [])
    .map(r => {
      const raw = (r as { profiles: unknown }).profiles;
      return (Array.isArray(raw) ? raw[0] : raw) as
        | { id: string; supervision_state: string | null; deletion_requested_at: string | null }
        | null;
    })
    .filter(
      (p): p is NonNullable<typeof p> =>
        Boolean(p) && p!.supervision_state === 'supervised' && !p!.deletion_requested_at
    )
    .map(p => p.id);
  if ((rows ?? []).length === 0) {
    throw new Response(
      JSON.stringify({ error: 'Guardian access required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return { user, athleteIds };
}

/**
 * Is this email on the admin allowlist?
 *
 * Pure and exported ONLY so the fail-closed property is testable — it is the
 * whole of the admin gate, and until Aug 2026 it had no test at all. The
 * contract, pinned in `__tests__/admin-allowlist.test.ts`:
 *
 *   - an empty / whitespace / unset allowlist denies EVERYONE (fail closed —
 *     a missing env var must never open the door)
 *   - a missing email denies
 *   - case and surrounding whitespace are ignored on both sides
 *   - matching is exact per entry, never substring
 *
 * Admin = email on ADMIN_EMAILS (comma-separated, server-only). The original
 * implementation checked a `profiles.role` column that does not exist, so it
 * 403'd for everyone. An env allowlist is the right size for the MVP; a real
 * roles system can replace it later.
 */
export function isAdminEmail(
  email: string | null | undefined,
  allowlist: string | undefined
): boolean {
  const admins = (allowlist || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (admins.length === 0) return false;
  if (!email) return false;
  return admins.includes(email.trim().toLowerCase());
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireAuth(request);

  if (!isAdminEmail(user.email, process.env.ADMIN_EMAILS)) {
    throw new Response(
      JSON.stringify({ error: 'Admin access required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return user;
}