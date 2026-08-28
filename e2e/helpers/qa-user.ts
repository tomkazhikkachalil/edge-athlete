import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { request, type APIRequestContext } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Disposable QA user machinery for the smoke suite.
 *
 * The suite runs against the real Supabase project (no staging exists), so
 * every run creates a unique `edgeqa-<rand>@example.com` user with a PRIVATE
 * profile and deletes it in teardown. Golf fixtures block the auth-user
 * cascade (deleting the user 500s while a group_posts round exists), so
 * deletion walks the chain child-first — the order is load-bearing.
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

/** Load .env.local into process.env for keys not already set (CI sets them). */
/**
 * Which deployment the suite drives. Defaults to the local dev/prod server;
 * set E2E_BASE_URL to smoke a real deployment, e.g.
 *   E2E_BASE_URL=https://edge-athlete.vercel.app npm run test:e2e
 *
 * NOTE this changes only WHICH SERVER handles the requests. The suite has
 * always run against the real Supabase project (there is no staging), so the
 * data side is identical either way — same tables, same disposable users,
 * same teardown.
 */
export const E2E_BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Cookie scope for the target — localhost is http, a deployment is https. */
export function baseUrlCookieScope(): { domain: string; secure: boolean } {
  const url = new URL(E2E_BASE_URL);
  return { domain: url.hostname, secure: url.protocol === 'https:' };
}

export function loadEnv(): void {
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

export function requireEnv(): { url: string; anonKey: string; serviceKey: string } {
  loadEnv();
  for (const key of ENV_KEYS) {
    if (!process.env[key]) {
      throw new Error(`Smoke suite needs ${key} (set it in .env.local or CI secrets)`);
    }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

export function adminClient(): SupabaseClient {
  const { url, serviceKey } = requireEnv();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface QaUser {
  id: string;
  email: string;
  password: string;
}

export interface QaUserOptions {
  /** Distinct per user — identical names ambiguate every name-based
   *  assertion, and neither name may be a substring of the other. */
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export async function createQaUser(opts: QaUserOptions = {}): Promise<QaUser> {
  const displayName = opts.displayName ?? 'Edge QA';
  const firstName = opts.firstName ?? 'Edge';
  const lastName = opts.lastName ?? 'QA';
  const admin = adminClient();
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `edgeqa-${rand}@example.com`;
  const password = `Qa!${Math.random().toString(36).slice(2, 12)}9`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const id = data.user.id;

  // Admin-created users get NO profiles row from the signup trigger — insert
  // one by hand. visibility 'private' keeps the QA user out of public
  // surfaces (and is REQUIRED by the follow-request spec: only private
  // targets produce pending requests); onboarded_at set so login lands on
  // /athlete, not /onboarding.
  const { error: profileError } = await admin.from('profiles').insert({
    id,
    email,
    display_name: displayName,
    full_name: displayName,
    first_name: firstName,
    last_name: lastName,
    visibility: 'private',
    onboarded_at: new Date().toISOString(),
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
    throw new Error(`profile insert failed: ${profileError.message}`);
  }

  // Vacuous-pass trap: a probe against a fixture that silently doesn't exist
  // looks identical to a real pass. Assert the row is really there.
  const { data: check } = await admin
    .from('profiles')
    .select('id, visibility')
    .eq('id', id)
    .maybeSingle();
  if (!check || check.visibility !== 'private') {
    throw new Error('QA profile row missing or not private after insert');
  }

  return { id, email, password };
}

/**
 * Mint the @supabase/ssr cookie for a password session so specs can start
 * authenticated without driving the login UI every time (auth-login.spec.ts
 * covers the real UI path once).
 */
export async function mintStorageState(user: QaUser): Promise<{
  cookies: Array<{
    name: string; value: string; domain: string; path: string;
    expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax';
  }>;
  origins: never[];
}> {
  const { url, anonKey } = requireEnv();
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) throw new Error(`password sign-in failed: ${error?.message}`);

  const projectRef = new URL(url).hostname.split('.')[0];
  // @supabase/ssr format: "base64-" + base64url(session JSON), no padding —
  // and no '=' anywhere, which the API's cookie parser historically required.
  const value =
    'base64-' +
    Buffer.from(JSON.stringify(data.session)).toString('base64url');

  const scope = baseUrlCookieScope();
  const cookie = {
    name: `sb-${projectRef}-auth-token`,
    value,
    domain: scope.domain,
    path: '/',
    expires: -1,
    httpOnly: false,
    // A cookie minted `secure: false` is simply not sent over https, so the
    // whole suite would run signed-out against a deployment.
    secure: scope.secure,
    sameSite: 'Lax' as const,
  };
  if (value.length > 3180) {
    // Chunked format (.0/.1) — sessions are ~2.5k so this is rare; split
    // conservatively rather than failing mysteriously at request time.
    const half = Math.ceil(value.length / 2);
    return {
      cookies: [
        { ...cookie, name: `${cookie.name}.0`, value: value.slice(0, half) },
        { ...cookie, name: `${cookie.name}.1`, value: value.slice(half) },
      ],
      origins: [],
    };
  }
  return { cookies: [cookie], origins: [] };
}

/**
 * Delete a QA user and everything it created. Social tables first (their
 * cross-user rows — a notification ABOUT you, a conversation you're in —
 * are what block the partner's deletion), then the golf chain (which blocks
 * the auth-user cascade). Every step is idempotent so teardown can run
 * against a user that created nothing, or whose partner is already gone.
 */
export async function deleteQaUser(userId: string): Promise<void> {
  const admin = adminClient();

  // ── Managed athletes first (Wave 1 soft delete made this load-bearing) ────
  // Child deletion via the guardian route PARKS the profile (30-day soft
  // delete), so it outlives the run. Deleting the guardian then cascades
  // their profile_access row, and 048's deferred zero-access trigger REFUSES
  // when the parked child would be left with no rows — which silently no-oped
  // the profiles delete and made the auth delete fail. (It slipped through
  // whenever the child had a credentials SELF row: one row remained, the
  // trigger stayed quiet, and the parked child + shadow user leaked instead.)
  // Recursively deleting managed athletes first fixes both shapes; children
  // are never guardians, so the recursion is one level deep.
  const { data: managed } = await admin
    .from('profile_access')
    .select('profile_id')
    .eq('user_id', userId)
    .eq('role', 'guardian');
  for (const m of managed ?? []) {
    await deleteQaUser(m.profile_id);
  }

  // ── Social cleanup ────────────────────────────────────────────────────────
  // Conversations this user touches, as participant or creator.
  const { data: partRows } = await admin
    .from('conversation_participants').select('conversation_id').eq('profile_id', userId);
  const { data: createdConvos } = await admin
    .from('conversations').select('id').eq('created_by', userId);
  const convoIds = [...new Set([
    ...(partRows ?? []).map(r => r.conversation_id),
    ...(createdConvos ?? []).map(r => r.id),
  ])];
  if (convoIds.length) {
    // ALL messages in those conversations — the partner's rows block too.
    await admin.from('message_reactions').delete().in('message_id',
      ((await admin.from('messages').select('id').in('conversation_id', convoIds)).data ?? []).map(m => m.id));
    await admin.from('messages').delete().in('conversation_id', convoIds);
    await admin.from('conversation_participants').delete().in('conversation_id', convoIds);
    await admin.from('conversations').delete().in('id', convoIds);
  }
  // Follows in both directions (cascades their follow notifications).
  await admin.from('follows').delete().eq('follower_id', userId);
  await admin.from('follows').delete().eq('following_id', userId);
  // Notifications owned by OR CAUSED BY this user — actor_id is the sneaky
  // direction: A's actions create rows owned by B that block deleting A.
  await admin.from('notifications').delete().eq('user_id', userId);
  await admin.from('notifications').delete().eq('actor_id', userId);
  // Auto-created the first time the user is notified.
  await admin.from('notification_preferences').delete().eq('user_id', userId);

  // ── Golf / posts chain ────────────────────────────────────────────────────
  const { data: rounds } = await admin
    .from('group_posts').select('id').eq('creator_id', userId);
  const roundIds = (rounds ?? []).map(r => r.id);

  const partsQuery = admin.from('group_post_participants').select('id');
  const { data: parts } = roundIds.length
    ? await partsQuery.or(`group_post_id.in.(${roundIds.join(',')}),profile_id.eq.${userId}`)
    : await partsQuery.eq('profile_id', userId);
  const partIds = (parts ?? []).map(p => p.id);

  if (partIds.length) {
    const { data: scores } = await admin
      .from('golf_participant_scores').select('id').in('participant_id', partIds);
    const scoreIds = (scores ?? []).map(s => s.id);
    if (scoreIds.length) {
      await admin.from('golf_hole_scores').delete().in('golf_participant_id', scoreIds);
      await admin.from('golf_participant_scores').delete().in('id', scoreIds);
    }
  }
  if (roundIds.length) {
    await admin.from('group_post_media').delete().in('group_post_id', roundIds);
  }
  if (partIds.length) {
    await admin.from('group_post_participants').delete().in('id', partIds);
  }
  if (roundIds.length) {
    await admin.from('golf_scorecard_data').delete().in('group_post_id', roundIds);
    await admin.from('posts').delete().in('group_post_id', roundIds);
  }
  // Tag rows in BOTH directions (tagged-in and tagger) — before the posts
  // deletes; FKs claim CASCADE, but explicit child-first is house style.
  await admin.from('post_tags').delete().eq('tagged_profile_id', userId);
  await admin.from('post_tags').delete().eq('created_by_profile_id', userId);
  await admin.from('posts').delete().eq('profile_id', userId);
  if (roundIds.length) {
    await admin.from('group_posts').delete().in('id', roundIds);
  }
  await admin.from('athlete_equipment').delete().eq('profile_id', userId);
  // Workout chain + vitals — FKs claim CASCADE, but house style is explicit
  // child-first deletes (the golf chain taught why). All carry profile_id.
  await admin.from('workout_sets').delete().eq('profile_id', userId);
  await admin.from('workout_exercises').delete().eq('profile_id', userId);
  await admin.from('workout_sessions').delete().eq('profile_id', userId);
  await admin.from('athlete_vitals').delete().eq('profile_id', userId);
  await admin.from('athlete_achievements').delete().eq('profile_id', userId);

  // Delete the profiles row FIRST (the account-deletion flow's order): the
  // auth-side cascade fires the search-document delete trigger as
  // supabase_auth_admin, which 112 shipped without privileges for (fixed in
  // 114 via SECURITY DEFINER) — profile-first keeps teardown independent of
  // that, exactly like hardDeleteAccount.
  // Error-CHECKED: a silent failure here (the zero-access trigger above) is
  // exactly how parked children and stranded guardians leaked for a day.
  const { error: profileError } = await admin.from('profiles').delete().eq('id', userId);
  if (profileError) {
    throw new Error(`profiles delete(${userId}) failed: ${profileError.message}`);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteUser(${userId}) failed: ${error.message}`);
}

/**
 * Best-effort sweep of edgeqa-* users older than 24h — orphans from runs
 * that were killed before teardown. Unique emails per run make collisions
 * impossible, so orphans only accumulate; this drains them.
 */
export async function sweepStaleQaUsers(): Promise<void> {
  try {
    const admin = adminClient();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of data?.users ?? []) {
      if (!u.email?.startsWith('edgeqa-')) continue;
      if (new Date(u.created_at).getTime() > cutoff) continue;
      await deleteQaUser(u.id).catch(err =>
        console.warn(`[e2e sweep] could not delete stale ${u.email}:`, err.message)
      );
    }
  } catch (err) {
    console.warn('[e2e sweep] skipped:', (err as Error).message);
  }
}

/** Read a persisted QA user from e2e/.auth (written by global setup). */
export function loadQaUser(file: 'user.json' | 'user-b.json'): QaUser {
  return JSON.parse(readFileSync(join(process.cwd(), 'e2e', '.auth', file), 'utf8'));
}

/**
 * An API request context authenticated as one of the QA users — for driving
 * cross-user setup that the UI can't (athlete search is public-only, so two
 * private QA users cannot find each other in any search modal). Caller must
 * `await ctx.dispose()` when done.
 */
export async function apiAs(
  stateFile: 'state.json' | 'state-b.json'
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: E2E_BASE_URL,
    storageState: join(process.cwd(), 'e2e', '.auth', stateFile),
  });
}

/**
 * Read an error body defensively: the platform answers some failures itself
 * (Vercel 413s are plain text, gateways send HTML), so unconditional
 * response.json() turns an infrastructure error into a SyntaxError.
 */
export async function readErrorBody(response: { text(): Promise<string> }): Promise<string> {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.slice(0, 500);
  }
}
