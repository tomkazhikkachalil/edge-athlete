// ── Google / YouTube — the network half (Videos program Phase 3, Nov 5 2026) ──
// SERVER ONLY. Every call Edge Athlete makes to Google for the YouTube
// connection is in this file, so the hosts, the credentials and the timeouts
// have one owner (the Polar module's shape, polar-server.ts).
//
//   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET   the Google Cloud OAuth client
//                                               (Web application; the redirect
//                                               URI is <origin>/api/videos/youtube/callback)
//   YOUTUBE_MOCK_BASE   points the three hosts at a local stand-in for the e2e
//                       suite; IGNORED in a production deployment.
//
// Not configured → `youtubeConfig()` is null and every door answers "not
// available". Nothing is half-on. The device never sees the refresh token:
// the ONE thing handed to a browser is the hour-long access token for the
// upload the connector themselves asked for.

import { createHash, randomBytes } from 'crypto';
import {
  expiresAtFrom, parseIsoDuration, YOUTUBE_SPORTS_CATEGORY,
  type UploadSessionInput,
} from './youtube-connection';

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  authBase: string;
  tokenBase: string;
  apiBase: string;
}

const HOSTS = {
  authBase: 'https://accounts.google.com',
  tokenBase: 'https://oauth2.googleapis.com',
  apiBase: 'https://www.googleapis.com',
};

const TIMEOUT_MS = 15_000;

export function youtubeConfig(env: Record<string, string | undefined> = process.env): YouTubeConfig | null {
  const clientId = env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const mock = env.VERCEL_ENV === 'production' ? undefined : env.YOUTUBE_MOCK_BASE?.trim().replace(/\/+$/, '');
  return { clientId, clientSecret, ...(mock ? { authBase: mock, tokenBase: mock, apiBase: mock } : HOSTS) };
}

async function call(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store', redirect: 'error' });
  } catch (e) {
    console.error('[youtube] request failed:', new URL(url).pathname, e instanceof Error ? e.name : 'error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

// ── PKCE ────────────────────────────────────────────────────────────────────
/** A fresh verifier (43 chars of base64url — RFC 7636) and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function isPkceVerifier(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(v);
}

// ── The consent screen ──────────────────────────────────────────────────────
/** Where the person is sent to say yes at Google. `access_type=offline` + `prompt=consent` = a refresh token every time. */
export function youtubeAuthorizeUrl(cfg: YouTubeConfig, opts: { state: string; redirectUri: string; scopes: readonly string[]; codeChallenge: string }): string {
  const u = new URL('/o/oauth2/v2/auth', cfg.authBase);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('scope', opts.scopes.join(' '));
  u.searchParams.set('state', opts.state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export type YouTubeTokens = { ok: true; accessToken: string; refreshToken: string | null; expiresAt: number; scope: string } | { ok: false; invalidGrant: boolean };

function readTokens(body: unknown, now: number): YouTubeTokens {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const accessToken = typeof b.access_token === 'string' ? b.access_token : '';
  if (!accessToken) return { ok: false, invalidGrant: b.error === 'invalid_grant' };
  return {
    ok: true,
    accessToken,
    refreshToken: typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : null,
    expiresAt: expiresAtFrom(b.expires_in, now),
    scope: typeof b.scope === 'string' ? b.scope : '',
  };
}

/** The code Google handed back → the tokens (the verifier proves this server started the flow). */
export async function youtubeExchangeCode(cfg: YouTubeConfig, code: string, redirectUri: string, codeVerifier: string, now = Date.now()): Promise<YouTubeTokens> {
  const res = await call(`${cfg.tokenBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: codeVerifier }).toString(),
  });
  if (!res) return { ok: false, invalidGrant: false };
  return readTokens(await res.json().catch(() => null), now);
}

/** A fresh access token from the refresh token. `invalidGrant` = the consent is gone (withdrawn, or the Testing app's week ran out). */
export async function youtubeRefresh(cfg: YouTubeConfig, refreshToken: string, now = Date.now()): Promise<YouTubeTokens> {
  const res = await call(`${cfg.tokenBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  });
  if (!res) return { ok: false, invalidGrant: false };
  return readTokens(await res.json().catch(() => null), now);
}

/** Best effort: tell Google the grant is over. */
export async function youtubeRevoke(cfg: YouTubeConfig, token: string): Promise<boolean> {
  const res = await call(`${cfg.tokenBase}/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return !!res && res.ok;
}

// ── The Data API reads ──────────────────────────────────────────────────────
export type YouTubeRead<T> = { ok: true; value: T } | { ok: false; unauthorized: boolean };

async function readJson<T>(cfg: YouTubeConfig, path: string, accessToken: string, pick: (body: unknown) => T | null): Promise<YouTubeRead<T>> {
  const res = await call(`${cfg.apiBase}${path}`, { method: 'GET', headers: bearer(accessToken) });
  if (!res) return { ok: false, unauthorized: false };
  if (res.status === 401 || res.status === 403) return { ok: false, unauthorized: res.status === 401 };
  if (!res.ok) return { ok: false, unauthorized: false };
  const value = pick(await res.json().catch(() => null));
  return value === null ? { ok: false, unauthorized: false } : { ok: true, value };
}

export interface MyChannel { id: string; title: string; uploadsPlaylistId: string | null }

/** The channel of the Google account that said yes; `channel: null` when the account has none (the `nochannel` word) — a read that worked. */
export async function youtubeMyChannel(cfg: YouTubeConfig, accessToken: string): Promise<YouTubeRead<MyChannel | null>> {
  const read = await readJson(cfg, '/youtube/v3/channels?part=snippet,contentDetails&mine=true', accessToken, body => {
    const items = (body as { items?: unknown[] } | null)?.items;
    if (!Array.isArray(items)) return null;
    const first = items[0] as { id?: unknown; snippet?: { title?: unknown }; contentDetails?: { relatedPlaylists?: { uploads?: unknown } } } | undefined;
    if (!first || typeof first.id !== 'string') return { channel: null as MyChannel | null };
    return {
      channel: {
        id: first.id,
        title: typeof first.snippet?.title === 'string' ? first.snippet.title : '',
        uploadsPlaylistId: typeof first.contentDetails?.relatedPlaylists?.uploads === 'string' ? first.contentDetails.relatedPlaylists.uploads : null,
      } as MyChannel | null,
    };
  });
  return read.ok ? { ok: true, value: read.value.channel } : read;
}

export interface ChannelUpload { videoId: string; title: string; publishedAt: string | null; thumbnail: string | null }

/** The channel's own uploads, newest first — the ids to link in one tap. */
export async function youtubeChannelUploads(cfg: YouTubeConfig, accessToken: string, uploadsPlaylistId: string, max = 25): Promise<YouTubeRead<ChannelUpload[]>> {
  const n = Math.max(1, Math.min(50, Math.floor(max)));
  return readJson(cfg, `/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${n}&playlistId=${encodeURIComponent(uploadsPlaylistId)}`, accessToken, body => {
    const items = (body as { items?: unknown[] } | null)?.items;
    if (!Array.isArray(items)) return null;
    const out: ChannelUpload[] = [];
    for (const raw of items) {
      const it = raw as { contentDetails?: { videoId?: unknown; videoPublishedAt?: unknown }; snippet?: { title?: unknown; thumbnails?: Record<string, { url?: unknown }> } };
      const videoId = it.contentDetails?.videoId;
      if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
      const thumbs = it.snippet?.thumbnails ?? {};
      const thumb = thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url;
      out.push({ videoId, title: typeof it.snippet?.title === 'string' ? it.snippet.title : '', publishedAt: typeof it.contentDetails?.videoPublishedAt === 'string' ? it.contentDetails.videoPublishedAt : null, thumbnail: typeof thumb === 'string' ? thumb : null });
    }
    return out;
  });
}

export interface VideoDetails { durationMs: number | null; title: string | null; thumbnail: string | null; privacy: string | null }

/** `videos.list` for one id: the duration Phase 1 left null, the title, the poster Google chose. */
export async function youtubeVideoDetails(cfg: YouTubeConfig, accessToken: string, videoId: string): Promise<YouTubeRead<VideoDetails | null>> {
  const read = await readJson(cfg, `/youtube/v3/videos?part=contentDetails,snippet,status&id=${encodeURIComponent(videoId)}`, accessToken, body => {
    const items = (body as { items?: unknown[] } | null)?.items;
    if (!Array.isArray(items)) return null;
    const first = items[0] as { contentDetails?: { duration?: unknown }; snippet?: { title?: unknown; thumbnails?: Record<string, { url?: unknown }> }; status?: { privacyStatus?: unknown } } | undefined;
    if (!first) return { details: null as VideoDetails | null }; // no such video: a read that worked
    const thumbs = first.snippet?.thumbnails ?? {};
    const thumb = thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url;
    return {
      details: {
        durationMs: parseIsoDuration(first.contentDetails?.duration),
        title: typeof first.snippet?.title === 'string' ? first.snippet.title : null,
        thumbnail: typeof thumb === 'string' ? thumb : null,
        privacy: typeof first.status?.privacyStatus === 'string' ? first.status.privacyStatus : null,
      } as VideoDetails | null,
    };
  });
  return read.ok ? { ok: true, value: read.value.details } : read;
}

// ── The resumable upload session ────────────────────────────────────────────
export type UploadSession = { ok: true; sessionUri: string } | { ok: false; unauthorized: boolean; status: number };

/**
 * The server opens the session (it holds the token); the device then PUTs the
 * bytes to the session URI, chunk by chunk, with the hour-long access token —
 * never through Edge Athlete or Vercel.
 */
export async function youtubeCreateUploadSession(cfg: YouTubeConfig, accessToken: string, input: UploadSessionInput): Promise<UploadSession> {
  const res = await call(`${cfg.apiBase}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      ...bearer(accessToken),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(input.sizeBytes),
      'X-Upload-Content-Type': input.contentType,
    },
    body: JSON.stringify({
      snippet: { title: input.title, description: input.description, categoryId: YOUTUBE_SPORTS_CATEGORY },
      status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!res) return { ok: false, unauthorized: false, status: 0 };
  const location = res.headers.get('location');
  if (!res.ok || !location) return { ok: false, unauthorized: res.status === 401, status: res.status };
  return { ok: true, sessionUri: location };
}
