// ── The ONE reader and writer of activity_connections (mig 247) ─────────────
// A connection is the athlete's standing consent for a watch or an app to
// deliver their workouts. Everything that touches the table goes through
// here, for two reasons:
//
//   • the table holds the two things no response may ever carry — the
//     encrypted provider secret and the upload link's token hash. The reader
//     below selects the five DISPLAY columns by name and nothing else; a
//     route never selects from the table itself.
//   • before 247 has run (it runs on prod by hand) the table does not exist:
//     every function here answers "not supported" instead of failing.
//
// Disconnecting DELETES the row. The activities a connection delivered stay —
// they are the athlete's, and they are removed like any other activity.

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import { openSecret, sealSecret, secretBoxReady } from '@/lib/crypto/secret-box-server';
import { PROVIDER_DEFS, type ConnectionProvider, type ConnectionRow } from './connections';
import { polarConfig, polarDeleteUser } from './providers/polar-server';

type Admin = SupabaseClient;

/** The display columns — the ONLY ones a reader for the screen may name. */
export const CONNECTION_DISPLAY_COLUMNS = 'provider, status, connected_at, last_sync_at, last_error';

export type ConnectionsRead =
  | { supported: true; rows: ConnectionRow[] }
  /** 247 has not run in this environment. */
  | { supported: false; rows: [] };

export async function readConnections(admin: Admin, profileId: string): Promise<ConnectionsRead> {
  const { data, error } = await admin
    .from('activity_connections')
    .select(CONNECTION_DISPLAY_COLUMNS)
    .eq('profile_id', profileId);
  if (error) {
    if (isMissingTableError(error.code)) return { supported: false, rows: [] };
    throw new Error(`Failed to read connections: ${error.message}`);
  }
  return { supported: true, rows: (data ?? []) as ConnectionRow[] };
}

export type DisconnectOutcome =
  | { ok: true; removed: boolean }
  | { ok: false; status: 404 | 500; error: string };

/**
 * Remove one connection of one athlete. `removed: false` when there was none
 * (a second tap, another device) — the same success, so the screen settles.
 */
export async function disconnect(admin: Admin, profileId: string, provider: ConnectionProvider): Promise<DisconnectOutcome> {
  // An OAuth connection is withdrawn AT THE PROVIDER first (the token is
  // revoked there, the webhooks stop) — best effort: whatever the provider
  // answers, our row and its sealed token go.
  if (PROVIDER_DEFS[provider].kind === 'oauth') await revokeAtProvider(admin, profileId, provider);
  const { data, error } = await admin
    .from('activity_connections')
    .delete()
    .eq('profile_id', profileId)
    .eq('provider', provider)
    .select('id');
  if (error) {
    if (isMissingTableError(error.code)) return { ok: false, status: 404, error: 'Connected apps are not available yet.' };
    console.error('[connections] disconnect failed:', error.message);
    return { ok: false, status: 500, error: 'Could not disconnect. Try again.' };
  }
  return { ok: true, removed: (data ?? []).length > 0 };
}

/** A supervised athlete cannot hold a connection (the calendar feed link's
 *  rule): it is a standing delivery nobody in the guardian console can see. */
export async function isSupervisedProfile(admin: Admin, profileId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('supervision_state').eq('id', profileId).maybeSingle();
  return data?.supervision_state === 'supervised';
}

// ── The personal upload link (PR 3) ─────────────────────────────────────────
// A capability URL: whoever holds it can add workouts to the athlete's
// Vitals, so the raw token is shown ONCE and only its sha256 is stored (the
// calendar feed token's shape). Losing it is fixed by making a new one, which
// replaces the hash — the old link stops at once.

/** 32 random bytes, base64url: 43 characters. */
export function generateLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLinkToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type MintOutcome =
  | { ok: true; token: string; rotated: boolean }
  | { ok: false; status: 404 | 500; error: string };

/** Create the athlete's upload link, or replace it (rotated: true). A
 *  rotation keeps the connection's history (connected_at, last_sync_at). */
export async function mintUploadLink(admin: Admin, profileId: string): Promise<MintOutcome> {
  const { data: existing, error: readError } = await admin
    .from('activity_connections')
    .select('id')
    .eq('profile_id', profileId)
    .eq('provider', 'upload_link')
    .maybeSingle();
  if (readError) {
    if (isMissingTableError(readError.code)) return { ok: false, status: 404, error: 'Connected apps are not available yet.' };
    console.error('[connections] upload link read failed:', readError.message);
    return { ok: false, status: 500, error: 'Could not create your link. Try again.' };
  }
  const token = generateLinkToken();
  const { error } = await admin.from('activity_connections').upsert(
    { profile_id: profileId, provider: 'upload_link', token_hash: hashLinkToken(token), status: 'active', last_error: null },
    { onConflict: 'profile_id,provider' }
  );
  if (error) {
    console.error('[connections] upload link write failed:', error.message);
    return { ok: false, status: 500, error: 'Could not create your link. Try again.' };
  }
  return { ok: true, token, rotated: !!existing };
}

/** The connection a raw token opens, or null (a malformed token never reaches the database). */
export async function findUploadLink(admin: Admin, rawToken: string): Promise<{ id: string; profileId: string } | null> {
  if (!LINK_TOKEN_RE.test(rawToken)) return null;
  const { data, error } = await admin
    .from('activity_connections')
    .select('id, profile_id')
    .eq('provider', 'upload_link')
    .eq('token_hash', hashLinkToken(rawToken))
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error.code)) console.error('[connections] upload link lookup failed:', error.message);
    return null;
  }
  return data ? { id: data.id as string, profileId: data.profile_id as string } : null;
}

/**
 * What a delivery did to the connection: a delivery that was read stamps
 * last_sync_at and clears any problem; one that could not be read at all
 * marks it `error` with the reason in our words (the next good one heals
 * it). Best effort — a delivery never fails because this write did.
 */
export async function recordDelivery(admin: Admin, connectionId: string, outcome: { ok: true } | { ok: false; error: string }): Promise<void> {
  const patch = outcome.ok
    ? { last_sync_at: new Date().toISOString(), status: 'active', last_error: null }
    : { status: 'error', last_error: outcome.error.slice(0, 300) };
  const { error } = await admin.from('activity_connections').update(patch).eq('id', connectionId);
  if (error) console.error('[connections] delivery stamp failed:', error.message);
}

// ── Provider (OAuth) connections (PR 4) ─────────────────────────────────────
// The provider's tokens are sealed by the secret box under a context that
// names the row (profile + provider): a box copied to another row does not
// open. These are the only functions that read `secret_ciphertext`, and what
// they return never leaves the server.

/** What a provider connection's secret holds once opened. */
export interface ProviderSecret {
  accessToken: string;
}

const secretContext = (profileId: string, provider: ConnectionProvider) => `activity_connections:${profileId}:${provider}`;

export interface ProviderConnection {
  id: string;
  profileId: string;
  providerUserId: string;
  /** Null when the box does not open (a rotated-away key, a damaged row). */
  secret: ProviderSecret | null;
}

function openRow(row: { id: unknown; profile_id: unknown; provider_user_id: unknown; secret_ciphertext: unknown }, provider: ConnectionProvider): ProviderConnection {
  const profileId = row.profile_id as string;
  const opened = openSecret(row.secret_ciphertext as string | null, secretContext(profileId, provider));
  let secret: ProviderSecret | null = null;
  if (opened) {
    try {
      const parsed = JSON.parse(opened) as { accessToken?: unknown };
      if (typeof parsed.accessToken === 'string' && parsed.accessToken) secret = { accessToken: parsed.accessToken };
    } catch {
      secret = null;
    }
  }
  return { id: row.id as string, profileId, providerUserId: (row.provider_user_id as string | null) ?? '', secret };
}

const PROVIDER_COLUMNS = 'id, profile_id, provider_user_id, secret_ciphertext';

export type ConnectOutcome =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 500 | 503; error: string };

/** Store (or refresh) a provider connection. The token is sealed here. */
export async function connectProvider(
  admin: Admin,
  profileId: string,
  provider: ConnectionProvider,
  input: { providerUserId: string; secret: ProviderSecret }
): Promise<ConnectOutcome> {
  if (!secretBoxReady()) return { ok: false, status: 503, error: 'Connected apps are not available yet.' };
  const label = PROVIDER_DEFS[provider].label;
  const { error } = await admin.from('activity_connections').upsert(
    {
      profile_id: profileId,
      provider,
      provider_user_id: input.providerUserId,
      secret_ciphertext: sealSecret(JSON.stringify(input.secret), secretContext(profileId, provider)),
      status: 'active',
      last_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,provider' }
  );
  if (error) {
    if (isMissingTableError(error.code)) return { ok: false, status: 404, error: 'Connected apps are not available yet.' };
    // 247's unique on (provider, provider_user_id): one provider account feeds ONE athlete.
    if (error.code === '23505') return { ok: false, status: 409, error: `This ${label} account is already connected to another Edge Athlete account.` };
    console.error('[connections] connect failed:', error.message);
    return { ok: false, status: 500, error: `Could not connect ${label}. Try again.` };
  }
  return { ok: true };
}

/** The connection a provider's own user id names — how a webhook finds the athlete. */
export async function findProviderConnection(admin: Admin, provider: ConnectionProvider, providerUserId: string): Promise<ProviderConnection | null> {
  const { data, error } = await admin
    .from('activity_connections')
    .select(PROVIDER_COLUMNS)
    .eq('provider', provider)
    .eq('provider_user_id', providerUserId)
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error.code)) console.error('[connections] provider lookup failed:', error.message);
    return null;
  }
  return data ? openRow(data, provider) : null;
}

/** One athlete's connection to a provider. */
export async function readProviderConnection(admin: Admin, profileId: string, provider: ConnectionProvider): Promise<ProviderConnection | null> {
  const { data, error } = await admin
    .from('activity_connections')
    .select(PROVIDER_COLUMNS)
    .eq('profile_id', profileId)
    .eq('provider', provider)
    .maybeSingle();
  if (error || !data) return null;
  return openRow(data, provider);
}

/** The connections a daily sync walks: active ones, least recently synced first. */
export async function listActiveConnections(admin: Admin, provider: ConnectionProvider, limit: number): Promise<ProviderConnection[]> {
  const { data, error } = await admin
    .from('activity_connections')
    .select(PROVIDER_COLUMNS)
    .eq('provider', provider)
    .eq('status', 'active')
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) {
    if (!isMissingTableError(error.code)) console.error('[connections] list failed:', error.message);
    return [];
  }
  return (data ?? []).map(row => openRow(row, provider));
}

/** The provider said the athlete withdrew consent (a 401 on their token):
 *  the connection reads "needs attention" until they connect again. */
export async function markRevoked(admin: Admin, connectionId: string): Promise<void> {
  const { error } = await admin.from('activity_connections').update({ status: 'revoked', secret_ciphertext: null, last_error: null }).eq('id', connectionId);
  if (error) console.error('[connections] mark revoked failed:', error.message);
}

async function revokeAtProvider(admin: Admin, profileId: string, provider: ConnectionProvider): Promise<void> {
  try {
    if (provider !== 'polar') return;
    const cfg = polarConfig();
    const conn = await readProviderConnection(admin, profileId, provider);
    if (!cfg || !conn?.secret || !conn.providerUserId) return;
    const done = await polarDeleteUser(cfg, conn.secret.accessToken, conn.providerUserId);
    if (!done) console.error('[connections] provider revoke did not confirm:', provider);
  } catch (e) {
    console.error('[connections] provider revoke failed:', e instanceof Error ? e.message : e);
  }
}
