import { after, NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient, type User } from '@supabase/supabase-js';
import { parseCookieHeader } from './cookies';
import {
  resolveProfileAction,
  type ProfileAction,
  type ProfileRole,
} from './profile-roles';
import { verifySessionLocally } from './auth/edge-session';
import { claimsToUser, jwtSecret } from './auth/jwt';

/**
 * The Supabase admin client (service role). Created on FIRST CALL, never at
 * module scope (env vars are absent during static analysis), and then kept:
 * a Fluid instance serves many requests, and building a client per call
 * (speed round 2 found one per gate, several per request) was pure waste.
 * The client holds no per-user state — `auth.persistSession` is off.
 */
function makeAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
let adminSingleton: ReturnType<typeof makeAdminClient> | null = null;
export function getSupabaseAdmin() {
  adminSingleton ??= makeAdminClient();
  return adminSingleton;
}
/** Test seam only. */
export function __resetAdminForTests() {
  adminSingleton = null;
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

// ── Who is calling (speed round 2, Oct 4 2026) ──────────────────────────────
//
// Every gate used to ask Supabase Auth over the network (100–300 ms) and
// nothing was shared within a request. Now:
//   - the access token in the cookie is verified LOCALLY when
//     SUPABASE_JWT_SECRET is set (src/lib/auth/jwt.ts — HS256, issuer,
//     audience, expiry with the refresh margin). Unset, or anything the local
//     check cannot vouch for, falls through to the network `getUser` — the
//     authority. A failed local verify is never a 401 by itself.
//   - the answer is memoized PER REQUEST (a WeakMap on the NextRequest, so
//     two gates in one route share one check; different requests never do).
//   - `fresh: true` forces the network user: the write gate (a suspended or
//     banned account must be refused at once — Supabase Auth's ban makes
//     `getUser` 401, the moderation column makes the gate 403), the admin and
//     moderator gates, and the two routes that read account fields the token
//     does not carry (pinned by src/lib/__tests__/fresh-auth-sites.test.ts).
//
// Tom's decision: the access-token lifetime is 10 minutes in the dashboard,
// so a suspended account keeps READ access for at most that long.

type AuthAnswer = { user: User | null; error: { message: string } | null; verified: 'local' | 'network' };
const authMemo = new WeakMap<NextRequest, Promise<AuthAnswer>>();
const freshMemo = new WeakMap<NextRequest, Promise<AuthAnswer>>();

export interface AuthOptions {
  /** Always the network user (bans, moderation, account fields). */
  fresh?: boolean;
}

async function networkAuth(request: NextRequest): Promise<AuthAnswer> {
  const supabase = getServerClient(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user, error, verified: 'network' };
}

function resolveAuth(request: NextRequest, opts: AuthOptions = {}): Promise<AuthAnswer> {
  if (opts.fresh) {
    let pending = freshMemo.get(request);
    if (!pending) {
      pending = networkAuth(request);
      freshMemo.set(request, pending);
    }
    return pending;
  }
  let pending = authMemo.get(request);
  if (!pending) {
    pending = (async () => {
      const secret = jwtSecret();
      if (secret) {
        const cookies = parseCookieHeader(request.headers.get('cookie') ?? '');
        const claims = await verifySessionLocally({
          getCookie: name => cookies[name],
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
          secret,
        });
        if (claims) return { user: claimsToUser(claims), error: null, verified: 'local' as const };
      }
      // A fresh answer already taken for this request serves here too.
      const fresh = freshMemo.get(request);
      return fresh ?? networkAuth(request);
    })();
    authMemo.set(request, pending);
  }
  return pending;
}

/**
 * Non-throwing auth for routes that return their own 401. Gives back both the
 * user (nullable) and the cookie-scoped RLS client for subsequent queries
 * (PostgREST verifies the same JWT on every query, so RLS never depended on
 * the network check).
 */
export async function getServerAuth(request: NextRequest, opts: AuthOptions = {}) {
  const supabase = getServerClient(request);
  const { user, error } = await resolveAuth(request, opts);
  return { supabase, user, error };
}

/** Every authenticated write counts against the SHADOW 'write-general'
 *  bucket — AFTER the response (`after`), so it costs the request nothing,
 *  and it never refuses (rate-limit-core.ts). Imported lazily: rate-limit.ts
 *  imports this module. Outside a request scope (a unit test) it does nothing. */
function observeWrite(request: NextRequest, userId: string): void {
  const method = request.method?.toUpperCase?.() ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  try {
    after(async () => {
      const { enforceRateLimit } = await import('@/lib/rate-limit');
      await enforceRateLimit(request, 'write-general', { userId });
    });
  } catch {
    /* no request scope — nothing to observe */
  }
}

export async function requireAuth(request: NextRequest, opts: AuthOptions = {}) {
  try {
    const { user, error } = await resolveAuth(request, opts);

    if (error || !user) {
      throw new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    observeWrite(request, user.id);
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
 * Admin = email on ADMIN_EMAILS (comma-separated, server-only) — OR the
 * project owner (OWNER_EMAILS below, Tom's call Sep 13 2026: "for now, for
 * easy testing" — his Vercel project carries no ADMIN_EMAILS). The owner
 * is admitted whether or not the env var is set; everyone else still needs
 * the list, and an unset list still denies everyone else. The original
 * implementation checked a `profiles.role` column that does not exist, so it
 * 403'd for everyone. An env allowlist is the right size for the MVP; a real
 * roles system can replace both.
 */
export const OWNER_EMAILS: readonly string[] = ['tom.kazhikkachalil@gmail.com'];

export function isAdminEmail(
  email: string | null | undefined,
  allowlist: string | undefined
): boolean {
  if (!email) return false;
  const needle = email.trim().toLowerCase();
  if (OWNER_EMAILS.includes(needle)) return true;
  const admins = (allowlist || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (admins.length === 0) return false;
  return admins.includes(needle);
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireAuth(request, { fresh: true });

  if (!isAdminEmail(user.email, process.env.ADMIN_EMAILS)) {
    throw new Response(
      JSON.stringify({ error: 'Admin access required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return user;
}
// ── Platform roles (Support & Reporting, Spec 1 — migration 222) ────────────
//
// `platform_admins` holds owner | moderator rows. The env allowlist above
// keeps meaning OWNER (nothing existing changes — requireAdmin stays the
// gate for every pre-222 admin route); a moderator row admits the support
// queue and nothing else. Only an owner writes the table (the roles route
// passes intent 'manage_roles'). Pre-222 the read answers 42P01 and the
// role is whatever the allowlist says — the table is additive.

export type PlatformRole = 'owner' | 'moderator';

/** What a moderator may do; anything not listed is owner-only. */
// Authority PR 4: 'recover_authority' (the recovery panels) is owner-only
// for now — deliberately NOT in MODERATOR_INTENTS; open it later by adding it.
export type ModeratorIntent = 'work_queue' | 'delete_ticket' | 'manage_roles' | 'recover_authority';
const MODERATOR_INTENTS: ReadonlySet<ModeratorIntent> = new Set(['work_queue']);

/** The caller's platform role: the allowlist decides owner; the table decides moderator; else null. */
export async function platformRoleFor(user: { id: string; email?: string | null }): Promise<PlatformRole | null> {
  if (isAdminEmail(user.email, process.env.ADMIN_EMAILS)) return 'owner';
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('platform_admins')
    .select('role')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (error) {
    // 42P01 = the table is not live yet (222 not run): the allowlist alone decides.
    if (error.code !== '42P01') console.error('[platformRoleFor] read failed:', error.message);
    return null;
  }
  const role = data?.role;
  return role === 'owner' || role === 'moderator' ? role : null;
}

/**
 * The support-queue gate: an owner for every intent, a moderator for the
 * ones MODERATOR_INTENTS lists. Throws the same 401 / 403 Responses the
 * other gates do; the caller `return`s a caught Response, never rethrows.
 */
export async function requireModerator(request: NextRequest, opts: { intent: ModeratorIntent }) {
  const user = await requireAuth(request, { fresh: true });
  const role = await platformRoleFor(user);
  if (role === 'owner' || (role === 'moderator' && MODERATOR_INTENTS.has(opts.intent))) {
    return { user, role };
  }
  throw new Response(
    JSON.stringify({ error: role === 'moderator' ? 'Owner access required' : 'Admin access required' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── The write gate (Support & Reporting, Spec 2 — migration 223) ───────────
//
// A limited / suspended / banned account may READ everything and may reply
// to support; it may not create content or contact people. The gate is
// TARGETED — THE list of content + contact write routes in docs/SUPPORT.md
// calls it right after its own auth — never a blanket on every write. Pre-223
// (no column) every account reads as active.

/** A ready 403 when the account may not write right now; null when it may. */
export async function activeWriterRefusal(userId: string): Promise<Response | null> {
  const { effectiveState, writeRefusalMessage } = await import('./moderation/state');
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('profiles').select('moderation_state, moderation_until').eq('id', userId).maybeSingle();
  if (error) {
    // 42703 = pre-223; anything else fails OPEN with a log (a read blip must not lock out the app).
    if (error.code !== '42703') console.error('[activeWriterRefusal] read failed:', error.message);
    return null;
  }
  const state = effectiveState(data);
  if (state === 'active') return null;
  return new Response(
    JSON.stringify({ error: writeRefusalMessage(state, data?.moderation_until), code: 'account_limited', state }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}

/** requireAuth + the write gate; throws the 403 like the other gates (the caller `return`s a caught Response). */
export async function requireActiveWriter(request: NextRequest) {
  // fresh: a ban (Supabase Auth) and a moderation state (profiles) both bite
  // at once on a write — the local check would honour the token until expiry.
  const user = await requireAuth(request, { fresh: true });
  const refusal = await activeWriterRefusal(user.id);
  if (refusal) throw refusal;
  return user;
}
