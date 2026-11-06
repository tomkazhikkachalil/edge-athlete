// ── The YouTube connection — the ONE writer (Videos program Phase 3, Nov 5 2026) ──
// SERVER ONLY. Every read and write of `youtube_connections` (298) is here:
// connect (an upsert by owner), the access token with its refresh (sealed
// again when it changes), the revoked mark, disconnect (revoke at Google best
// effort, then DELETE). The rights: who may connect / disconnect / link is
// the owner's manager (videos-server.ts's two gates — the person or a
// guardian; the org's manage_video); who may UPLOAD is that manager AND the
// person whose Google account made the connection (an org's connection is
// the channel owner's grant, never an app role). No response ever carries
// the ciphertext: the projection in youtube-connection.ts is the access rule.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import { openSecret, sealSecret, secretBoxReady } from '@/lib/crypto/secret-box-server';
import { orgVideoAccess, profileManages } from './videos-server';
import {
  accessTokenFresh, isYouTubeSecret, mergeGrantedScopes, ownerColumns, projectConnection, secretContextFor,
  type ConnectionOwner, type YouTubeConnectionRow, type YouTubeConnectionView, type YouTubeSecret,
} from './youtube-connection';
import { youtubeConfig, youtubeRefresh, youtubeRevoke, type YouTubeConfig } from './google-youtube-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const CONNECTION_COLUMNS = 'id, profile_id, org_id, connected_by_user_id, channel_id, channel_title, scopes, status, last_error, connected_at';

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 500 | 503; error: string };

/** The feature is offered: Google credentials AND the sealing key on this deployment. */
export function youtubeConnectionsAvailable(): boolean {
  return !!youtubeConfig() && secretBoxReady();
}

function ownerQuery(admin: Admin, owner: ConnectionOwner) {
  const q = admin.from('youtube_connections').select(CONNECTION_COLUMNS);
  return owner.kind === 'profile' ? q.eq('profile_id', owner.profileId) : q.eq('org_id', owner.orgId);
}

/** The owner's connection, or null; `supported: false` before 298 has run here. */
export async function readConnection(admin: Admin, owner: ConnectionOwner): Promise<{ supported: boolean; row: YouTubeConnectionRow | null }> {
  const { data, error } = await ownerQuery(admin, owner).maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) return { supported: false, row: null };
    throw error;
  }
  return { supported: true, row: (data as YouTubeConnectionRow | null) ?? null };
}

/** Who manages this owner's videos — the person or a guardian; the org's manage_video. */
export async function ownerManaged(admin: Admin, owner: ConnectionOwner, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (owner.kind === 'profile') return profileManages(userId, owner.profileId);
  const a = await orgVideoAccess(admin, owner.side, owner.orgId, userId);
  return a.known && a.canManage;
}

/** The screen's view for this viewer. */
export async function connectionViewFor(admin: Admin, owner: ConnectionOwner, userId: string | null): Promise<YouTubeConnectionView> {
  const [read, canManage] = await Promise.all([readConnection(admin, owner), ownerManaged(admin, owner, userId)]);
  return projectConnection(read.row, { userId, canManage, available: youtubeConnectionsAvailable() });
}

export interface ConnectArgs {
  owner: ConnectionOwner;
  userId: string;
  channelId: string;
  channelTitle: string | null;
  grantedScope: string;
  secret: YouTubeSecret;
}

/** Connect (or reconnect) the owner's channel: ONE row per owner, the scopes merged, the secret sealed to the owner. */
export async function connectYouTube(admin: Admin, args: ConnectArgs): Promise<Outcome<YouTubeConnectionRow>> {
  if (!secretBoxReady()) return { ok: false, status: 503, error: 'Connections are not available here' };
  const existing = await readConnection(admin, args.owner);
  if (!existing.supported) return { ok: false, status: 503, error: 'Connections are not available here' };
  const scopes = mergeGrantedScopes(existing.row?.scopes, args.grantedScope);
  const sealed = sealSecret(JSON.stringify(args.secret), secretContextFor(args.owner));
  const fields = {
    connected_by_user_id: args.userId,
    channel_id: args.channelId,
    channel_title: args.channelTitle?.slice(0, 200) || null,
    scopes,
    secret_ciphertext: sealed,
    status: 'active',
    last_error: null,
    connected_at: new Date().toISOString(),
  };
  const q = existing.row
    ? admin.from('youtube_connections').update(fields).eq('id', existing.row.id)
    : admin.from('youtube_connections').insert({ ...ownerColumns(args.owner), ...fields });
  const { data, error } = await q.select(CONNECTION_COLUMNS).single();
  if (error || !data) {
    console.error('[youtube] connect failed:', error?.message);
    return { ok: false, status: 500, error: 'Could not save the connection' };
  }
  return { ok: true, value: data as YouTubeConnectionRow };
}

async function openSecretFor(admin: Admin, owner: ConnectionOwner): Promise<{ row: YouTubeConnectionRow; secret: YouTubeSecret } | null> {
  const { data } = await ownerQuery(admin, owner).select(`${CONNECTION_COLUMNS}, secret_ciphertext`).maybeSingle();
  const row = data as (YouTubeConnectionRow & { secret_ciphertext: string | null }) | null;
  if (!row || row.status !== 'active') return null;
  const opened = openSecret(row.secret_ciphertext, secretContextFor(owner));
  if (!opened) return null;
  try {
    const parsed: unknown = JSON.parse(opened);
    if (!isYouTubeSecret(parsed)) return null;
    const { secret_ciphertext: _c, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { row: rest, secret: parsed };
  } catch {
    return null;
  }
}

/** Google said the grant is over: the row says revoked and the box is emptied. */
export async function markRevoked(admin: Admin, connectionId: string, reason: string | null = null): Promise<void> {
  await admin.from('youtube_connections').update({ status: 'revoked', secret_ciphertext: null, last_error: reason?.slice(0, 300) ?? null }).eq('id', connectionId);
}

export async function recordError(admin: Admin, connectionId: string, message: string): Promise<void> {
  await admin.from('youtube_connections').update({ status: 'error', last_error: message.slice(0, 300) }).eq('id', connectionId);
}

export type TokenOutcome = { ok: true; accessToken: string; row: YouTubeConnectionRow } | { ok: false; status: 404 | 409 | 503; error: string };

/**
 * A live access token for the owner's connection: the sealed one while it is
 * fresh, else a refresh (sealed again). `invalid_grant` marks the row revoked
 * (the screen says "reconnect"); a transport failure leaves the row as it is.
 */
export async function withAccessToken(admin: Admin, cfg: YouTubeConfig, owner: ConnectionOwner, now = Date.now()): Promise<TokenOutcome> {
  if (!secretBoxReady()) return { ok: false, status: 503, error: 'Connections are not available here' };
  const opened = await openSecretFor(admin, owner);
  if (!opened) return { ok: false, status: 404, error: 'No YouTube channel is connected' };
  if (accessTokenFresh(opened.secret, now)) return { ok: true, accessToken: opened.secret.accessToken, row: opened.row };
  const refreshed = await youtubeRefresh(cfg, opened.secret.refreshToken, now);
  if (!refreshed.ok) {
    if (refreshed.invalidGrant) {
      await markRevoked(admin, opened.row.id, 'Google ended the connection');
      return { ok: false, status: 409, error: 'Google ended this connection — reconnect to continue' };
    }
    return { ok: false, status: 503, error: 'YouTube did not answer — try again' };
  }
  const next: YouTubeSecret = { refreshToken: refreshed.refreshToken ?? opened.secret.refreshToken, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  await admin.from('youtube_connections').update({ secret_ciphertext: sealSecret(JSON.stringify(next), secretContextFor(owner)), status: 'active', last_error: null }).eq('id', opened.row.id);
  return { ok: true, accessToken: next.accessToken, row: opened.row };
}

/** Disconnect: revoke at Google (best effort), then the row goes; the videos it uploaded stay the owner's. */
export async function disconnectYouTube(admin: Admin, owner: ConnectionOwner): Promise<Outcome<{ removed: boolean }>> {
  const cfg = youtubeConfig();
  if (cfg) {
    const opened = await openSecretFor(admin, owner).catch(() => null);
    if (opened) await youtubeRevoke(cfg, opened.secret.refreshToken).catch(() => false);
  }
  const q = admin.from('youtube_connections').delete();
  const { data, error } = await (owner.kind === 'profile' ? q.eq('profile_id', owner.profileId) : q.eq('org_id', owner.orgId)).select('id');
  if (error) {
    if (isMissingTableError(error.code)) return { ok: false, status: 404, error: 'No YouTube channel is connected' };
    return { ok: false, status: 500, error: 'Could not disconnect' };
  }
  return { ok: true, value: { removed: (data?.length ?? 0) > 0 } };
}

/** The upload gate: the owner's manager AND the person whose Google account made the connection, on a standing connection. */
/** Phase 4b: scheduling a broadcast is the SAME right as uploading — the owner's manager who is the connector, on a standing connection. One function, two names. */
export const broadcastRight = (admin: Admin, owner: ConnectionOwner, userId: string): Promise<Outcome<YouTubeConnectionRow>> => uploadRight(admin, owner, userId);

export async function uploadRight(admin: Admin, owner: ConnectionOwner, userId: string): Promise<Outcome<YouTubeConnectionRow>> {
  const [read, manages] = await Promise.all([readConnection(admin, owner), ownerManaged(admin, owner, userId)]);
  if (!manages) return { ok: false, status: 404, error: 'Not found' };
  if (!read.row) return { ok: false, status: 404, error: 'No YouTube channel is connected' };
  if (read.row.connected_by_user_id !== userId) return { ok: false, status: 403, error: 'Only the person who connected this channel can upload to it' };
  if (read.row.status !== 'active') return { ok: false, status: 409, error: 'Google ended this connection — reconnect to continue' };
  return { ok: true, value: read.row };
}
