import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RateLimitAction } from '@/lib/rate-limit-core';
import { SWEEP_CUTOFF_MS, DEPARTED_EMAIL_LIKE, isQaUserEmail, isShadowEmail, staleQaOrgs, staleQaTombstones, staleShadows, type AccessRow, type OrgRow, type ShadowRow, type TombstoneRow } from './qa-sweep-rules';
import { deleteQaOrgs } from './org';
import { request, type APIRequestContext } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

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

/**
 * Which deployment the suite drives. Defaults to the local server; set
 * E2E_BASE_URL to smoke a real deployment.
 *
 * TWO ENVIRONMENTS since Round 2 (Sep 21 2026). The data side comes from
 * the env file: `.env.local` is STAGING (the default — `npm run dev`, local
 * e2e, previews); `E2E_TARGET=prod` reads `.env.prod` — which must carry
 * prod's feature flags as well as its keys (`guardianFlagOn` reads them). Production — the
 * prod Supabase project OR the prod app URL — is REFUSED unless
 * `E2E_ALLOW_PROD=1` is set too; `npm run test:e2e:prod` sets all three.
 * The refusal is the guard against a probe that silently mints QA users
 * on prod because a shell had the wrong file loaded.
 */
export const E2E_BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const E2E_TARGET: 'prod' | 'local' = process.env.E2E_TARGET === 'prod' ? 'prod' : 'local';
const ENV_FILE = E2E_TARGET === 'prod' ? '.env.prod' : '.env.local';
/** The production project's ref and host — the two things the suite refuses without E2E_ALLOW_PROD=1. */
export const PROD_SUPABASE_REF = 'htwhmdoiszhhmwuflgci';
export const PROD_APP_HOST = 'edge-athlete.vercel.app';

/**
 * Vercel previews sit behind Vercel Authentication; the suite reaches them
 * with the project's "Protection Bypass for Automation" secret (created
 * Sep 21 2026, kept in .env.staging as VERCEL_AUTOMATION_BYPASS_SECRET).
 * Sent as a header on EVERY request when E2E_BASE_URL is a preview — the
 * Playwright config's extraHTTPHeaders and deploy.ts's raw fetch.
 */
export function bypassHeaders(): Record<string, string> {
  if (!/\.vercel\.app$/.test(new URL(E2E_BASE_URL).hostname) || new URL(E2E_BASE_URL).hostname === PROD_APP_HOST) return {};
  let secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) {
    try {
      secret = /^VERCEL_AUTOMATION_BYPASS_SECRET=(.+)$/m.exec(readFileSync(join(process.cwd(), '.env.staging'), 'utf8'))?.[1]?.trim();
    } catch {
      /* no .env.staging */
    }
  }
  // ONLY the bypass header: `x-vercel-set-bypass-cookie` makes Vercel answer
  // a self-redirect to plant the cookie, which a following fetch loops on.
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

/** Cookie scope for the target — localhost is http, a deployment is https. */
export function baseUrlCookieScope(): { domain: string; secure: boolean } {
  const url = new URL(E2E_BASE_URL);
  return { domain: url.hostname, secure: url.protocol === 'https:' };
}

export function loadEnv(): void {
  const envPath = join(process.cwd(), ENV_FILE);
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined) continue;
      process.env[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  refuseProdUnlessAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL, E2E_BASE_URL, process.env.E2E_ALLOW_PROD);
}

/** Pure: throws when either side is production and the flag is absent. */
export function refuseProdUnlessAllowed(supabaseUrl: string | undefined, baseUrl: string, allow: string | undefined): void {
  if (allow === '1') return;
  const ref = /https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)/.exec(supabaseUrl ?? '')?.[1];
  if (ref === PROD_SUPABASE_REF) throw new Error(`REFUSED: ${ENV_FILE} points at the PRODUCTION Supabase project. The suite runs on staging; a prod probe is \`npm run test:e2e:prod\` (E2E_TARGET=prod E2E_ALLOW_PROD=1).`);
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    /* refused below only by ref */
  }
  if (host === PROD_APP_HOST) throw new Error(`REFUSED: E2E_BASE_URL is the PRODUCTION app. A prod probe is \`npm run test:e2e:prod\` (E2E_TARGET=prod E2E_ALLOW_PROD=1).`);
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

/** Reset ONE user-keyed rate bucket for a QA user (phase 6 R2). rate_limits
 *  is DB-backed, so a tripped bucket poisons the next hour of runs too. Key
 *  shape: `${action}:${identifier}` — see buildRateLimitKey. Typed since the
 *  teardown hardening (Sep 24 2026): `action` is a RateLimitAction (a typo
 *  used to compile into a silent no-op), the user must be THE USER WHO POSTS
 *  (five registration specs reset the owner's bucket while the athlete
 *  posted — the 429 every prod probe after the first hit), and a refused
 *  delete THROWS instead of pretending. */
export async function resetRateBucket(
  admin: SupabaseClient,
  action: RateLimitAction,
  userId: string
): Promise<void> {
  const { error } = await admin.from('rate_limits').delete().like('key', `${action}:${userId}%`);
  if (error) throw new Error(`resetRateBucket(${action}, ${userId}) failed: ${error.message}`);
}

/** Every user-keyed bucket for these users — the run-wide belt the global
 *  setup fastens after minting A–D (their ids are fresh, so this only
 *  matters when a run reuses ids — but it costs one statement). Keys are
 *  `${action}:${identifier}` and a uuid never spells an IP, so the LIKE is
 *  exact enough. */
export async function resetQaBuckets(admin: SupabaseClient, userIds: readonly string[]): Promise<void> {
  for (const id of userIds) {
    const { error } = await admin.from('rate_limits').delete().like('key', `%:${id}%`);
    if (error) throw new Error(`resetQaBuckets(${id}) failed: ${error.message}`);
  }
}

/** An error-CHECKED delete step: the teardown's steps used to discard every
 *  `{ error }`, so a refused child delete surfaced only as an opaque
 *  `profiles delete failed` at the end. */
async function mustDelete(label: string, step: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await step;
  if (error) throw new Error(`${label} failed: ${error.message}`);
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
  /** Exact address instead of the random edgeqa-* one. Only for
   *  adminEmailForE2E(): the admin routes gate on ADMIN_EMAILS, which no
   *  random address can join. Addresses outside edgeqa-* are NOT swept —
   *  the spec that creates one deletes it in its own finally. */
  email?: string;
}

/**
 * The address a spec may create to sit on the target build's ADMIN_EMAILS —
 * `E2E_ADMIN_EMAIL`, unset by default. The admin-positive specs skip without
 * it (the allowlist is a server env; the QA users can never join it). Set it
 * to an address that (a) the target build lists in ADMIN_EMAILS and (b) no
 * real account owns — `edgeqa-admin@example.com` keeps it inside the sweep's
 * prefix. Never a real person's address: the spec creates AND deletes the
 * user.
 */
export function adminEmailForE2E(): string | null {
  loadEnv();
  const raw = process.env.E2E_ADMIN_EMAIL?.trim().toLowerCase();
  return raw && raw.includes('@') ? raw : null;
}

/**
 * Whether the guardian feature is on for the target build. Mirrors
 * features.ts (a plain env read) after loadEnv(), so it matches what the
 * local webServer baked in; CI leaves the flag unset → specs green-skip.
 * Use this instead of probing POST /api/guardian/athletes — the rate limit
 * runs before validation there, so every probe consumed one of the 5/day
 * athlete-create slots and a multi-spec battery 429'd real creates.
 */
export function guardianFlagOn(): boolean {
  loadEnv();
  return process.env.NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES === '1';
}

/**
 * Seed a supervised child directly (service role): shadow @minors.invalid
 * auth user + the SAME create_managed_profile RPC the guardian route calls,
 * with the restrictive safety literals. For specs that need a child to
 * EXIST but aren't testing the creation route — the route's 5/day/user rate
 * limit is a safety rail, not test budget (guardian-console keeps
 * exercising the real POST). Delete with deleteQaUser(childId) — children
 * are never guardians, so its recursion terminates.
 */
export async function createQaChild(
  guardianUserId: string,
  opts: { firstName: string; lastName?: string; handle: string; ageYears?: number }
): Promise<string> {
  const admin = adminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `pending-${randomBytes(8).toString('hex')}@minors.invalid`,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
  });
  if (createError || !created?.user) {
    throw new Error(`qa child shadow user failed: ${createError?.message}`);
  }
  const childId = created.user.id;
  const syntheticEmail = `${childId}@minors.invalid`;
  await admin.auth.admin.updateUserById(childId, { email: syntheticEmail, email_confirm: true });

  const now = new Date().toISOString();
  const dob = new Date(Date.UTC(new Date().getUTCFullYear() - (opts.ageYears ?? 10), 5, 15))
    .toISOString().split('T')[0];
  const fullName = [opts.firstName, opts.lastName].filter(Boolean).join(' ');
  const { error: rpcError } = await admin.rpc('create_managed_profile', {
    p_profile: {
      id: childId,
      email: syntheticEmail,
      first_name: opts.firstName,
      last_name: opts.lastName ?? null,
      full_name: fullName || null,
      display_name: fullName || opts.firstName,
      handle: opts.handle,
      dob,
      birthday: dob,
      user_type: 'athlete',
      sport: null,
      // Restrictive safety literals (household-policy RESTRICTIVE_PRESETS).
      visibility: 'private',
      messaging_permission: 'nobody',
      comment_moderation: 'held',
      supervision_state: 'supervised',
      dob_locked: true,
      jurisdiction: null,
      minor_threshold_age: 18,
      // jsonb_populate_record turns absent fields into explicit NULLs, which
      // bypass column defaults — NOT NULL columns must be supplied.
      created_at: now,
      updated_at: now,
      handle_change_count: 0,
    },
    p_guardian: guardianUserId,
  });
  if (rpcError) {
    await admin.auth.admin.deleteUser(childId).catch(() => {});
    throw new Error(`qa child create_managed_profile failed: ${rpcError.message}`);
  }
  return childId;
}

export async function createQaUser(opts: QaUserOptions = {}): Promise<QaUser> {
  const displayName = opts.displayName ?? 'Edge QA';
  const firstName = opts.firstName ?? 'Edge';
  const lastName = opts.lastName ?? 'QA';
  const admin = adminClient();
  const rand = Math.random().toString(36).slice(2, 10);
  const email = opts.email ?? `edgeqa-${rand}@example.com`;
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
  return { cookies: [cookie, ...(await previewBypassCookies())], origins: [] };
}

/**
 * The Vercel automation-bypass COOKIE for a preview target, fetched once
 * per process: `browser.newContext()` in a spec inherits no config header,
 * so the cookie rides in every storage-state file instead (signed-in and
 * the signed-out empty state alike — `previewStorageState()`). Empty off a
 * preview.
 */
let bypassCookiePromise: Promise<Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax' }>> | null = null;
export function previewBypassCookies() {
  if (!bypassCookiePromise) {
    bypassCookiePromise = (async () => {
      const headers = bypassHeaders();
      if (!headers['x-vercel-protection-bypass']) return [];
      const res = await fetch(`${E2E_BASE_URL}/api/health`, { headers: { ...headers, 'x-vercel-set-bypass-cookie': 'true' }, redirect: 'manual' });
      const raw = res.headers.get('set-cookie') ?? '';
      const m = /_vercel_jwt=([^;]+)/.exec(raw);
      if (!m) throw new Error(`preview bypass: no _vercel_jwt cookie came back from ${E2E_BASE_URL} (HTTP ${res.status}) — is VERCEL_AUTOMATION_BYPASS_SECRET current?`);
      const scope = baseUrlCookieScope();
      return [{ name: '_vercel_jwt', value: m[1], domain: scope.domain, path: '/', expires: -1, httpOnly: true, secure: scope.secure, sameSite: 'Lax' as const }];
    })();
  }
  return bypassCookiePromise;
}

/** A signed-out storage state that still passes the preview's protection. */
export async function previewStorageState(): Promise<{ cookies: Awaited<ReturnType<typeof previewBypassCookies>>; origins: never[] }> {
  return { cookies: await previewBypassCookies(), origins: [] };
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
  // Teardown hardening (Sep 24 2026): not only `role = 'guardian'` rows — a
  // roster STUB's access row is `{ role: 'supervised', user_id: <itself> }`
  // and a minor the guardian route parked keeps its rows too. Every profile
  // whose access rows are ALL held by this user (or by itself) goes first;
  // a child with a second, live guardian stays and only this user's row
  // cascades (one row remains, the deferred guard stays quiet).
  const { data: held, error: heldError } = await admin
    .from('profile_access')
    .select('profile_id')
    .eq('user_id', userId)
    .neq('profile_id', userId);
  if (heldError) throw new Error(`deleteQaUser(${userId}): profile_access read failed: ${heldError.message}`);
  const heldIds = [...new Set((held ?? []).map(r => r.profile_id as string))];
  if (heldIds.length) {
    const { data: others, error: othersError } = await admin
      .from('profile_access')
      .select('profile_id, user_id')
      .in('profile_id', heldIds)
      .neq('user_id', userId);
    if (othersError) throw new Error(`deleteQaUser(${userId}): profile_access read failed: ${othersError.message}`);
    const protectedIds = new Set((others ?? []).filter(r => r.user_id !== r.profile_id).map(r => r.profile_id as string));
    for (const child of heldIds) {
      if (!protectedIds.has(child)) await deleteQaUser(child);
    }
  }

  // ── The competition chain (the quirk the Sep 24 staging sweep met) ──────────
  // contest_results.entered_by / confirmed_by / disputed_by → profiles SET
  // NULL, participant_id → contest_participants CASCADE, and the entry is the
  // profile's (CASCADE): one profile delete fires the SET NULL update on a
  // results row whose participant is going in the SAME cascade → FK
  // violation. The results, participants and entries this profile owns go
  // first, explicitly. NOTE (238, Sep 24 2026): the PRODUCT keeps a departed
  // person's results (the deletion engine leaves a name-only tombstone);
  // this is QA teardown, which deletes them because the QA org they belong
  // to is going too — never a model of what account deletion does.
  const { data: entries } = await admin.from('competition_entries').select('id').eq('profile_id', userId);
  const entryIds = (entries ?? []).map(e => e.id as string);
  if (entryIds.length) {
    const { data: cps } = await admin.from('contest_participants').select('id').in('entry_id', entryIds);
    const cpIds = (cps ?? []).map(c => c.id as string);
    if (cpIds.length) {
      await mustDelete(`contest_results of ${userId}`, admin.from('contest_results').delete().in('participant_id', cpIds));
      await mustDelete(`contest_participants of ${userId}`, admin.from('contest_participants').delete().in('id', cpIds));
    }
    await mustDelete(`competition_entries of ${userId}`, admin.from('competition_entries').delete().in('id', entryIds));
  }
  await mustDelete(`contest_stat_lines of ${userId}`, admin.from('contest_stat_lines').delete().eq('profile_id', userId));
  // 238 (Sep 25 2026): a deleted profile no longer takes its performance rows
  // with it — the FK is SET NULL so a real person's facts outlive them. A QA
  // user's rows are test data, never facts: delete them BY PERSON first, or
  // every run leaves anonymous QA rows in the analysis dataset (the first
  // prod probe after 238 left 37).
  await mustDelete(`athlete_performances of ${userId}`, admin.from('athlete_performances').delete().eq('profile_id', userId));

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
  // Already gone (a stale e2e/.auth file from a run whose setup aborted) is
  // the state we want, not a failure.
  if (error && !/not found/i.test(error.message)) throw new Error(`deleteUser(${userId}) failed: ${error.message}`);
}

/**
 * Best-effort sweep of what runs killed before their teardown left behind —
 * older than 24h, so a run in flight is never swept by a concurrent one.
 * Three shapes since the teardown hardening (Sep 24 2026), taken in the
 * order the database wants: the QA ORGS first (Tom's strict rule — a QA-
 * shaped name, old, and an owner that is null or a stale QA user; their
 * cascades take sites, competitions, entries, results and memberships — the
 * bulk of what leaked: 1 021 orgs on staging), then the SHADOW users no live
 * holder protects (stubs and minors — children before their guardians by
 * construction), then the edgeqa-* USERS. Each deletion is caught on its
 * own; one refusal never aborts the rest; the whole sweep is non-fatal.
 */
export async function sweepStaleQa(): Promise<void> {
  try {
    const admin = adminClient();
    const cutoff = Date.now() - SWEEP_CUTOFF_MS;
    const { users, shadows, orgs, tombstones } = await listStaleQaShapes(admin, cutoff);
    const total = orgs.length + shadows.length + users.length + tombstones.length;
    if (total === 0) return;
    console.log(`[e2e sweep] stale QA shapes: orgs ${orgs.length} · shadows ${shadows.length} · users ${users.length} · tombstones ${tombstones.length}`);
    let deleted = 0;
    for (const o of orgs) {
      await deleteQaOrgs(admin, [o.id]).then(() => { deleted++; }).catch(err =>
        console.warn(`[e2e sweep] could not delete stale org ${o.name}:`, (err as Error).message));
    }
    for (const t of tombstones) {
      await deleteQaUser(t.id).then(() => { deleted++; }).catch(err =>
        console.warn(`[e2e sweep] could not delete stale tombstone ${t.full_name}:`, (err as Error).message));
    }
    for (const u of [...shadows, ...users]) {
      await deleteQaUser(u.id).then(() => { deleted++; }).catch(err =>
        console.warn(`[e2e sweep] could not delete stale ${u.email}:`, (err as Error).message));
    }
    console.log(`[e2e sweep] deleted ${deleted} / ${total}`);
  } catch (err) {
    console.warn('[e2e sweep] skipped:', (err as Error).message);
  }
}

/** The old name — the global setup's import until every caller says sweepStaleQa. */
export const sweepStaleQaUsers = sweepStaleQa;

/** The three stale shapes, by the pure rules in qa-sweep-rules.ts. */
export async function listStaleQaShapes(
  admin: ReturnType<typeof adminClient>,
  cutoff: number
): Promise<{ users: Array<{ id: string; email: string }>; shadows: ShadowRow[]; orgs: OrgRow[]; tombstones: TombstoneRow[] }> {
  const users = await listStaleQaUsers(admin, cutoff);
  const staleIds = new Set(users.map(u => u.id));
  // shadows: every stubs / minors auth user, then the rule over their access rows
  const shadowCandidates: ShadowRow[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers(page ${page}) failed: ${error.message}`);
    const list = data?.users ?? [];
    for (const u of list) {
      if (u.email && isShadowEmail(u.email)) shadowCandidates.push({ id: u.id, email: u.email, created_at: u.created_at });
    }
    if (list.length < perPage) break;
  }
  let access: AccessRow[] = [];
  if (shadowCandidates.length) {
    const { data, error } = await admin.from('profile_access').select('profile_id, user_id').in('profile_id', shadowCandidates.map(s => s.id));
    if (error) throw new Error(`profile_access read failed: ${error.message}`);
    access = (data ?? []) as AccessRow[];
  }
  const shadows = staleShadows(shadowCandidates, access, cutoff, staleIds);
  // orgs: the QA-shaped names, then the rule
  const { data: orgRows, error: orgError } = await admin
    .from('organizations').select('id, name, created_at, owner_profile_id').like('name', 'QA %').limit(5000);
  if (orgError) throw new Error(`organizations read failed: ${orgError.message}`);
  const orgs = staleQaOrgs((orgRows ?? []) as OrgRow[], cutoff, staleIds);
  // tombstones (238): departed QA profiles — no auth user, found by the name
  const { data: tombRows, error: tombError } = await admin
    .from('profiles').select('id, email, full_name, departed_at')
    .like('email', DEPARTED_EMAIL_LIKE).like('full_name', 'QA %').limit(5000);
  // pre-238 the column is missing — no tombstones can exist; anything else is loud
  if (tombError && !/departed_at/.test(tombError.message)) throw new Error(`tombstone read failed: ${tombError.message}`);
  const tombstones = staleQaTombstones((tombRows ?? []) as TombstoneRow[], cutoff);
  return { users, shadows, orgs, tombstones };
}

/**
 * Every edgeqa-* auth user created before `cutoff`, across EVERY page of
 * the auth listing. The sweep used to read page 1 of 200: once the leak
 * outgrew a page, the older orphans sat behind it forever (Round 1 PR 5).
 * Bounded at 20 pages × 1000 — a listing that long is its own emergency.
 */
export async function listStaleQaUsers(
  admin: ReturnType<typeof adminClient>,
  cutoff: number
): Promise<Array<{ id: string; email: string; created_at: string }>> {
  const stale: Array<{ id: string; email: string; created_at: string }> = [];
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers(page ${page}) failed: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (!u.email || !isQaUserEmail(u.email)) continue;
      if (new Date(u.created_at).getTime() > cutoff) continue;
      stale.push({ id: u.id, email: u.email, created_at: u.created_at });
    }
    if (users.length < perPage) break;
  }
  return stale;
}

/** Read a persisted QA user from e2e/.auth (written by global setup). */
export type QaUserFile = 'user.json' | 'user-b.json' | 'user-c.json' | 'user-d.json';
export type QaStateFile = 'state.json' | 'state-b.json' | 'state-c.json' | 'state-d.json' | 'anon.json';

export function loadQaUser(file: QaUserFile): QaUser {
  return JSON.parse(readFileSync(join(process.cwd(), 'e2e', '.auth', file), 'utf8'));
}

/**
 * An API request context authenticated as one of the QA users — for driving
 * cross-user setup that the UI can't (athlete search is public-only, so two
 * private QA users cannot find each other in any search modal). Caller must
 * `await ctx.dispose()` when done.
 */
export async function apiAs(
  stateFile: QaStateFile
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: E2E_BASE_URL,
    storageState: join(process.cwd(), 'e2e', '.auth', stateFile),
    extraHTTPHeaders: bypassHeaders(),
  });
}

/**
 * Read an error body defensively: the platform answers some failures itself
 * (Vercel 413s are plain text, gateways send HTML), so unconditional
 * response.json() turns an infrastructure error into a SyntaxError.
 */
/** True when the TARGET deployment has FEATURE_ORG_REGISTRATION on.
 *  The submit route answers 404 {error:'Not found'} BEFORE any org
 *  lookup when the flag is off; flag-on with a syntactically valid org
 *  id reaches auth/validation instead. Probing the target beats reading
 *  the LOCAL env (which lies about a remote prod build). */
export async function registrationFlagOnTarget(api: {
  post(url: string, opts?: unknown): Promise<{ status(): number; json(): Promise<unknown> }>;
}): Promise<boolean> {
  const res = await api.post(
    '/api/leagues/00000000-0000-4000-8000-000000000000/registrations',
    { data: {} }
  );
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return !(res.status() === 404 && body?.error === 'Not found');
}

export async function readErrorBody(response: { text(): Promise<string> }): Promise<string> {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.slice(0, 500);
  }
}
