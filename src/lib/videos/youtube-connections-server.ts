// ── The YouTube connection — the ONE writer (Videos program Phase 3, Nov 5 2026) ──
// SERVER ONLY. Every read and write of `youtube_connections` (298) is here:
// connect (an upsert by owner), the access token with its refresh (sealed
// again when it changes), the revoked mark, disconnect (revoke at Google best
// effort, then DELETE). Self-healing (Nov 10 2026): every call to YouTube goes
// through `callWithToken` — a 401 is answered with ONE forced refresh and one
// more try; only Google's `invalid_grant` or a 401 on a fresh token writes
// `revoked`. Nothing writes `error` any more; a row left in it heals itself. The rights: who may connect / disconnect / link is
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
  accessTokenFresh, channelRefusalText, channelVerdict, CALL_REFUSALS, CHANNEL_REFUSALS, isYouTubeSecret, ownerColumns, projectConnection, replacedChannel, scopesWithout, secretContextFor, shouldRevokeAtGoogle, storedScopesFor,
  TOKEN_FAILURES, tokenFailureFor, withOneRetry,
  type ChannelVerdict, type ConnectionOwner, type ScopeKey, type TokenFailure, type YouTubeConnectionRow, type YouTubeConnectionView, type YouTubeSecret,
} from './youtube-connection';
import { youtubeConfig, youtubeLiveDetails, youtubeMyChannel, youtubeReadConfig, youtubeRefresh, youtubeRevoke, type LiveDetails, type YouTubeConfig } from './google-youtube-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const CONNECTION_COLUMNS = 'id, profile_id, org_id, connected_by_user_id, channel_id, channel_title, scopes, status, last_error, connected_at';

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 500 | 503; error: string; /** the screen offers Reconnect */ reconnect?: boolean };

/** The feature is offered: Google credentials AND the sealing key on this deployment. */
export function youtubeConnectionsAvailable(): boolean {
  return !!youtubeConfig() && secretBoxReady();
}

/** Google's review of the OAuth app has passed (Tom sets YOUTUBE_APP_VERIFIED=1 then): the connect doors drop the "hasn't verified this app" sentence. */
export function youtubeAppVerified(env: Record<string, string | undefined> = process.env): boolean {
  return env.YOUTUBE_APP_VERIFIED?.trim() === '1';
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
  return projectConnection(read.row, { userId, canManage, available: youtubeConnectionsAvailable(), verified: youtubeAppVerified() });
}

export interface ConnectArgs {
  owner: ConnectionOwner;
  userId: string;
  channelId: string;
  channelTitle: string | null;
  grantedScope: string;
  /** What this consent asked for — the fallback when Google's answer lists nothing. */
  askedScope: ScopeKey;
  secret: YouTubeSecret;
}

/**
 * Connect (or reconnect) the owner's channel: ONE row per owner, the secret
 * sealed to the owner. The scopes are REPLACED by what Google's answer lists
 * (correct state, Nov 10 2026) — never merged with what the row held, which
 * may have been another Google account's. `replaced` names the channel a
 * reconnect swapped out, for the banner.
 */
export async function connectYouTube(admin: Admin, args: ConnectArgs): Promise<Outcome<{ row: YouTubeConnectionRow; replaced: string | null }>> {
  if (!secretBoxReady()) return { ok: false, status: 503, error: 'Connections are not available here' };
  const existing = await readConnection(admin, args.owner);
  if (!existing.supported) return { ok: false, status: 503, error: 'Connections are not available here' };
  const scopes = storedScopesFor(args.grantedScope, args.askedScope);
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
  return { ok: true, value: { row: data as YouTubeConnectionRow, replaced: replacedChannel(existing.row, args.channelId) } };
}

/** YouTube refused for a missing permission the row claimed: the row stops claiming it, so the screen asks once more instead of failing again. */
export async function dropScope(admin: Admin, row: Pick<YouTubeConnectionRow, 'id' | 'scopes'>, need: 'upload' | 'live'): Promise<void> {
  await admin.from('youtube_connections').update({ scopes: scopesWithout(row.scopes, need) }).eq('id', row.id);
}

type Opened = { ok: true; row: YouTubeConnectionRow; secret: YouTubeSecret } | { ok: false; failure: TokenFailure };

/** The owner's row with its box opened — or WHY there is no token (no row, revoked, a box this deployment cannot read). */
async function openSecretFor(admin: Admin, owner: ConnectionOwner): Promise<Opened> {
  const { data } = await ownerQuery(admin, owner).select(`${CONNECTION_COLUMNS}, secret_ciphertext`).maybeSingle();
  const full = data as (YouTubeConnectionRow & { secret_ciphertext: string | null }) | null;
  let secret: YouTubeSecret | null = null;
  if (full && full.status !== 'revoked') {
    const opened = openSecret(full.secret_ciphertext, secretContextFor(owner));
    try {
      const parsed: unknown = opened ? JSON.parse(opened) : null;
      if (isYouTubeSecret(parsed)) secret = parsed;
    } catch {
      secret = null;
    }
  }
  const failure = tokenFailureFor(full, !!secret);
  if (failure || !full || !secret) return { ok: false, failure: failure ?? 'unreadable' };
  const { secret_ciphertext: _c, ...row } = full; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ok: true, row, secret };
}

/** Google said the grant is over: the row says revoked and the box is emptied. */
export async function markRevoked(admin: Admin, connectionId: string, reason: string | null = null): Promise<void> {
  await admin.from('youtube_connections').update({ status: 'revoked', secret_ciphertext: null, last_error: reason?.slice(0, 300) ?? null }).eq('id', connectionId);
}

export type TokenRefusal = { ok: false; status: 404 | 409 | 503; error: string; reconnect: boolean; failure: TokenFailure };
export type TokenOutcome = { ok: true; accessToken: string; row: YouTubeConnectionRow } | TokenRefusal;

const refusal = (failure: TokenFailure): TokenRefusal => ({ ok: false, failure, ...TOKEN_FAILURES[failure] });

/**
 * A live access token for the owner's connection: the sealed one while it is
 * fresh, else a refresh (sealed again, and the row says `active`). `force`
 * refreshes even a token that looks fresh — the retry after a 401.
 * `invalid_grant` marks the row revoked (the screen says "reconnect"); a
 * transport failure leaves the row as it is.
 */
export async function withAccessToken(admin: Admin, cfg: YouTubeConfig, owner: ConnectionOwner, opts: { force?: boolean; now?: number } = {}): Promise<TokenOutcome> {
  const now = opts.now ?? Date.now();
  if (!secretBoxReady()) return refusal('unavailable');
  const opened = await openSecretFor(admin, owner);
  if (!opened.ok) return refusal(opened.failure);
  if (!opts.force && accessTokenFresh(opened.secret, now)) return { ok: true, accessToken: opened.secret.accessToken, row: opened.row };
  const refreshed = await youtubeRefresh(cfg, opened.secret.refreshToken, now);
  if (!refreshed.ok) {
    if (refreshed.invalidGrant) {
      await markRevoked(admin, opened.row.id, 'Google ended the connection');
      return refusal('revoked');
    }
    return refusal('busy');
  }
  const next: YouTubeSecret = { refreshToken: refreshed.refreshToken ?? opened.secret.refreshToken, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  await admin.from('youtube_connections').update({ secret_ciphertext: sealSecret(JSON.stringify(next), secretContextFor(owner)), status: 'active', last_error: null }).eq('id', opened.row.id);
  return { ok: true, accessToken: next.accessToken, row: { ...opened.row, status: 'active', last_error: null } };
}

/** Any answer from google-youtube-server.ts: its failing arm says whether YouTube answered 401. */
type Answer = { ok: true } | { ok: false; unauthorized: boolean };

export type Called<R> = { ok: true; value: R; accessToken: string; row: YouTubeConnectionRow } | TokenRefusal;

/**
 * THE way to call YouTube with an owner's connection. `value` is the call's
 * own answer (it may still be a refusal — a quota, a 403 — but never a 401:
 * a 401 is retried once on a forced fresh token, and a second one ends the
 * connection here). `accessToken` is the token that worked.
 */
export async function callWithToken<R extends Answer>(admin: Admin, cfg: YouTubeConfig, owner: ConnectionOwner, fn: (accessToken: string) => Promise<R>): Promise<Called<R>> {
  const out = await withOneRetry<Extract<TokenOutcome, { ok: true }>, TokenRefusal, R>(
    force => withAccessToken(admin, cfg, owner, { force }),
    token => fn(token.accessToken),
    result => !result.ok && result.unauthorized,
  );
  if (!out.ok) return out.failure;
  if (out.dead) {
    await markRevoked(admin, out.token.row.id, 'YouTube refused a fresh sign-in');
    return refusal('revoked');
  }
  let row = out.token.row;
  if (out.result.ok && row.status === 'error') {
    // A row an older build left in `error`: the call worked, so it stands.
    await admin.from('youtube_connections').update({ status: 'active', last_error: null }).eq('id', row.id);
    row = { ...row, status: 'active', last_error: null };
  }
  return { ok: true, value: out.result, accessToken: out.token.accessToken, row };
}

/**
 * The health check (the card asks, at most every ten minutes): one
 * `channels.list mine` — a unit of quota — through the retry. A dead grant
 * becomes `revoked` here instead of at the next upload; a renamed channel
 * gets its new title. Never throws; an unanswered call changes nothing.
 */
export async function checkConnection(admin: Admin, cfg: YouTubeConfig, owner: ConnectionOwner): Promise<void> {
  const called = await callWithToken(admin, cfg, owner, token => youtubeMyChannel(cfg, token)).catch(() => null);
  if (!called || !called.ok || !called.value.ok) return;
  const channel = called.value.value;
  const title = channel?.title.slice(0, 200) || null;
  if (channel && channel.id === called.row.channel_id && title && title !== called.row.channel_title) {
    await admin.from('youtube_connections').update({ channel_title: title }).eq('id', called.row.id);
  }
}

/**
 * Disconnect: the row goes; the videos it uploaded stay the owner's. The
 * grant is revoked at Google (best effort) ONLY when the connector holds no
 * other connection here — Google revokes per account, so revoking for one
 * owner would end the same person's other channel connection too.
 */
export async function disconnectYouTube(admin: Admin, owner: ConnectionOwner): Promise<Outcome<{ removed: boolean }>> {
  const cfg = youtubeConfig();
  if (cfg) {
    const opened = await openSecretFor(admin, owner).catch(() => null);
    if (opened?.ok) {
      const { count } = await admin.from('youtube_connections').select('id', { count: 'exact', head: true }).eq('connected_by_user_id', opened.row.connected_by_user_id).neq('id', opened.row.id);
      if (shouldRevokeAtGoogle(count ?? 0)) await youtubeRevoke(cfg, opened.secret.refreshToken).catch(() => false);
    }
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
  if (read.row.status === 'revoked') return { ok: false, status: 409, error: TOKEN_FAILURES.revoked.error, reconnect: true };
  return { ok: true, value: read.row };
}

/**
 * Only the connected channel (Nov 11 2026): whose video is this, for this
 * owner? One `videos.list` read with the connection's own token (it sees the
 * channel's unlisted and private videos, and heals a 401), and the server's
 * key when the token cannot answer — the check needs only the video's
 * channel id and the row's. `enforced: false` = YouTube connections are not
 * configured on this deployment, so the rule is off with the feature.
 * `details` is the read itself (the lookup route reuses it — one read).
 */
export interface ChannelCheck {
  enforced: boolean;
  verdict: ChannelVerdict;
  channelTitle: string | null;
  /** The read was refused for YouTube's daily limit. */
  quota: boolean;
  details: LiveDetails | null;
}

export async function videoChannelCheck(admin: Admin, owner: ConnectionOwner, videoId: string): Promise<ChannelCheck> {
  const cfg = youtubeConfig();
  if (!cfg || !secretBoxReady()) return { enforced: false, verdict: 'own', channelTitle: null, quota: false, details: null };
  const { row } = await readConnection(admin, owner);
  if (!row) return { enforced: true, verdict: 'unconnected', channelTitle: null, quota: false, details: null };
  let video: LiveDetails | null | undefined;
  let quota = false;
  if (row.status !== 'revoked') {
    const called = await callWithToken(admin, cfg, owner, token => youtubeLiveDetails({ apiBase: cfg.apiBase, accessToken: token }, videoId));
    if (called.ok && called.value.ok) video = called.value.value;
    else if (called.ok && !called.value.ok) quota = called.value.quota;
  }
  if (video === undefined) {
    const key = youtubeReadConfig();
    const viaKey = key ? await youtubeLiveDetails({ apiBase: key.apiBase, apiKey: key.apiKey }, videoId) : null;
    if (viaKey?.ok) video = viaKey.value;
    else if (viaKey && !viaKey.ok) quota = quota || viaKey.quota;
  }
  return { enforced: true, verdict: channelVerdict(row.channel_id, video), channelTitle: row.channel_title, quota, details: video ?? null };
}

/** The refusal a route answers for a check that is not `own`: our sentence and the status (the daily limit keeps its own words). */
export function channelRefusal(check: ChannelCheck): { status: number; body: { error: string; channel: ChannelVerdict; needs_connection?: true } } | null {
  if (!check.enforced || check.verdict === 'own') return null;
  if (check.verdict === 'unreadable' && check.quota) return { status: CALL_REFUSALS.quota.status, body: { error: CALL_REFUSALS.quota.error, channel: 'unreadable' } };
  return {
    status: CHANNEL_REFUSALS[check.verdict].status,
    body: { error: channelRefusalText(check.verdict, check.channelTitle), channel: check.verdict, ...(check.verdict === 'unconnected' ? { needs_connection: true as const } : {}) },
  };
}
