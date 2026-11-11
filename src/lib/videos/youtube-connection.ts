// ── The YouTube connection — the pure rules (Videos program Phase 3, Nov 5 2026) ──
// A channel connected ONCE to a profile or an org (migration 298), so a full
// game can be uploaded straight to it and its uploads linked in one tap.
// This file is the vocabulary and the projection: the scopes, the owner
// reference, the privacy words, the secret's shape, what a screen may see
// (never the secret), and the duration Google writes. One type import, as
// rules.ts does; nothing else.

import type { OrgKind } from '@/lib/orgs/org-ref';

/** Google's scopes, incremental: `readonly` at connect (the channel + its uploads), `upload` on the first upload, `live` (force-ssl — sensitive) on the first scheduled broadcast (Phase 4b). */
export const YOUTUBE_SCOPES = {
  readonly: 'https://www.googleapis.com/auth/youtube.readonly',
  upload: 'https://www.googleapis.com/auth/youtube.upload',
  live: 'https://www.googleapis.com/auth/youtube.force-ssl',
} as const;
export type ScopeKey = keyof typeof YOUTUBE_SCOPES;
export const SCOPE_KEYS: readonly ScopeKey[] = ['readonly', 'upload', 'live'];

export function isScopeKey(v: unknown): v is ScopeKey {
  return v === 'readonly' || v === 'upload' || v === 'live';
}

/** The scope URLs a consent screen asks for: always readonly, plus the one asked (Google's include_granted_scopes keeps the earlier grants). */
export function scopesFor(key: ScopeKey): string[] {
  return key === 'readonly' ? [YOUTUBE_SCOPES.readonly] : [YOUTUBE_SCOPES.readonly, YOUTUBE_SCOPES[key]];
}

/** The keys a stored (or granted) scope list carries. */
export function scopeKeysOf(scopes: readonly string[] | null | undefined): ScopeKey[] {
  const out: ScopeKey[] = [];
  for (const key of SCOPE_KEYS) if (scopes?.includes(YOUTUBE_SCOPES[key])) out.push(key);
  return out;
}

export function hasScope(scopes: readonly string[] | null | undefined, key: ScopeKey): boolean {
  return !!scopes?.includes(YOUTUBE_SCOPES[key]);
}

/** Google answers `scope` as a space-joined string; keep only ours, in a stable order, once each. */
export function mergeGrantedScopes(stored: readonly string[] | null | undefined, granted: string | readonly string[] | null | undefined): string[] {
  const seen = new Set<string>(stored ?? []);
  const list = typeof granted === 'string' ? granted.split(/\s+/) : (granted ?? []);
  for (const s of list) if (s) seen.add(s);
  return SCOPE_KEYS.map(k => YOUTUBE_SCOPES[k]).filter(url => seen.has(url));
}

// ── The owner ───────────────────────────────────────────────────────────────
export type ConnectionOwner = { kind: 'profile'; profileId: string } | { kind: 'org'; side: OrgKind; orgId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `profile:<uuid>` | `club:<uuid>` | `league:<uuid>` — the one spelling a query string or a state carries. */
export function parseOwnerRef(raw: unknown): ConnectionOwner | null {
  if (typeof raw !== 'string') return null;
  const [kind, id, extra] = raw.split(':');
  if (extra !== undefined || !id || !UUID_RE.test(id)) return null;
  if (kind === 'profile') return { kind: 'profile', profileId: id.toLowerCase() };
  if (kind === 'club' || kind === 'league') return { kind: 'org', side: kind, orgId: id.toLowerCase() };
  return null;
}

export function ownerRef(owner: ConnectionOwner): string {
  return owner.kind === 'profile' ? `profile:${owner.profileId}` : `${owner.side}:${owner.orgId}`;
}

/** The row columns an owner fills. */
export function ownerColumns(owner: ConnectionOwner): { profile_id: string | null; org_id: string | null } {
  return owner.kind === 'profile' ? { profile_id: owner.profileId, org_id: null } : { profile_id: null, org_id: owner.orgId };
}

/** The secret box's context — the row's owner, so a box never opens for another owner. */
export function secretContextFor(owner: ConnectionOwner): string {
  return `youtube_connections:${ownerRef(owner)}`;
}

/** Where a connect lands the person back: the owner's Videos surface. */
export function returnPathFor(owner: ConnectionOwner, query: string): string {
  const q = query ? `?${query}` : '';
  return owner.kind === 'profile' ? `/athlete${q}${q ? '&' : '?'}tab=videos` : `/app/org/${owner.side}/${owner.orgId}${q}${q ? '&' : '?'}section=website`;
}

/** A channel's uploads playlist is its id with the leading "UC" as "UU" — YouTube's standing convention, so nothing extra is stored. */
export function uploadsPlaylistFor(channelId: string): string | null {
  return /^UC[A-Za-z0-9_-]{22}$/.test(channelId) ? `UU${channelId.slice(2)}` : null;
}

// ── The upload's privacy word ───────────────────────────────────────────────
export const UPLOAD_PRIVACIES = ['public', 'unlisted', 'private'] as const;
export type UploadPrivacy = (typeof UPLOAD_PRIVACIES)[number];

export function parseUploadPrivacy(v: unknown): UploadPrivacy | null {
  return typeof v === 'string' && (UPLOAD_PRIVACIES as readonly string[]).includes(v) ? (v as UploadPrivacy) : null;
}

// ── The secret ──────────────────────────────────────────────────────────────
/** What the sealed box holds. `expiresAt` is epoch ms. */
export interface YouTubeSecret {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

export function isYouTubeSecret(v: unknown): v is YouTubeSecret {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.refreshToken === 'string' && s.refreshToken.length > 0 && typeof s.accessToken === 'string' && typeof s.expiresAt === 'number';
}

/** Refresh this long before the token's end, so a request started now never meets a dead token. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export function accessTokenFresh(secret: Pick<YouTubeSecret, 'expiresAt'>, now: number): boolean {
  return secret.expiresAt - now > TOKEN_REFRESH_SKEW_MS;
}

/** `expires_in` seconds from Google → the epoch ms the token ends; a missing or odd value = already stale. */
export function expiresAtFrom(expiresIn: unknown, now: number): number {
  const n = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn);
  return Number.isFinite(n) && n > 0 ? now + n * 1000 : now;
}

// ── The row and the projection ──────────────────────────────────────────────
export type ConnectionStatus = 'active' | 'revoked' | 'error';

export interface YouTubeConnectionRow {
  id: string;
  profile_id: string | null;
  org_id: string | null;
  connected_by_user_id: string;
  channel_id: string;
  channel_title: string | null;
  scopes: string[] | null;
  status: ConnectionStatus;
  last_error: string | null;
  connected_at: string;
}

/** The screen's view — built key by key, so the secret can never ride along. */
export interface YouTubeConnectionView {
  /** The feature is offered here (credentials + the sealing key on the deployment). */
  available: boolean;
  connected: boolean;
  channelId: string | null;
  channelTitle: string | null;
  scopes: ScopeKey[];
  status: ConnectionStatus | null;
  connectedAt: string | null;
  /** The viewer is the person whose Google account this is. */
  connectedByMe: boolean;
  /** The viewer manages this owner's videos (may connect, disconnect, link). */
  canManage: boolean;
  /** The viewer may upload to the channel: manages, is the connector, and the connection stands. */
  canUpload: boolean;
  /** The viewer may schedule a live broadcast on the channel (Phase 4b): the same three facts — the scope is asked at the moment of need. */
  canBroadcast: boolean;
  /** Why the connection needs attention, in our words. */
  problem: string | null;
}

export const PROBLEMS = {
  revoked: 'Google ended this connection — reconnect to keep using the channel here.',
  error: 'The last call to YouTube failed — reconnect if it keeps happening.',
} as const;

export function problemFor(row: Pick<YouTubeConnectionRow, 'status' | 'last_error'> | null): string | null {
  if (!row) return null;
  if (row.status === 'revoked') return PROBLEMS.revoked;
  if (row.status === 'error') return row.last_error ?? PROBLEMS.error;
  return null;
}

export function projectConnection(
  row: YouTubeConnectionRow | null,
  viewer: { userId: string | null; canManage: boolean; available: boolean }
): YouTubeConnectionView {
  const connectedByMe = !!row && !!viewer.userId && row.connected_by_user_id === viewer.userId;
  return {
    available: viewer.available,
    connected: !!row,
    channelId: row ? row.channel_id : null,
    channelTitle: row ? row.channel_title : null,
    scopes: row ? scopeKeysOf(row.scopes) : [],
    status: row ? row.status : null,
    connectedAt: row ? row.connected_at : null,
    connectedByMe,
    canManage: viewer.canManage,
    // Self-healing (Nov 10 2026): only `revoked` ends a connection — an `error` row still holds its grant and heals on the next good call.
    canUpload: !!row && row.status !== 'revoked' && viewer.canManage && connectedByMe,
    canBroadcast: !!row && row.status !== 'revoked' && viewer.canManage && connectedByMe,
    problem: problemFor(row),
  };
}

/** The connect flow's answers, by the `connect_error` word the callback sends back. */
export const CONNECT_ERRORS: Record<string, string> = {
  denied: 'You said no at Google — nothing was connected.',
  expired: 'That took too long — start the connection again.',
  unavailable: 'YouTube connections are not available here yet.',
  busy: 'Too many attempts — try again in a while.',
  forbidden: 'Only a manager of these videos can connect a channel.',
  limited: 'Your account cannot connect a channel right now.',
  nochannel: 'That Google account has no YouTube channel — create one on YouTube first.',
  failed: 'Google did not complete the connection — try again.',
};

// ── Self-healing (Nov 10 2026) ───────────────────────────────────────────────
// A 401 from YouTube is first a stale token, not a dead connection: the call
// is made again ONCE with a freshly refreshed token. Only two things end a
// connection — Google's `invalid_grant` on the refresh, or a 401 on a token
// minted a moment ago. A transport failure, a 5xx, a quota answer end nothing.

/** Why no token could be had, and what the screen may do about it. */
export type TokenFailure = 'none' | 'revoked' | 'unreadable' | 'busy' | 'unavailable';

export const TOKEN_FAILURES: Record<TokenFailure, { status: 404 | 409 | 503; error: string; reconnect: boolean }> = {
  none: { status: 404, error: 'No YouTube channel is connected', reconnect: false },
  revoked: { status: 409, error: 'Google ended this connection — reconnect to continue', reconnect: true },
  unreadable: { status: 409, error: 'This connection has to be made again — reconnect to continue', reconnect: true },
  busy: { status: 503, error: 'YouTube did not answer — try again', reconnect: false },
  unavailable: { status: 503, error: 'Connections are not available here', reconnect: false },
};

/** What the opened row allows: a token, or the reason there is none. `error` rows still open — they heal. */
export function tokenFailureFor(row: Pick<YouTubeConnectionRow, 'status'> | null, secretReadable: boolean): TokenFailure | null {
  if (!row) return 'none';
  if (row.status === 'revoked') return 'revoked';
  return secretReadable ? null : 'unreadable';
}

export type Retried<TOk, TFail, R> =
  | { ok: false; failure: TFail }
  | { ok: true; token: TOk; result: R; attempts: 1 | 2; /** the SECOND answer was a 401 too — the grant is gone */ dead: boolean };

/**
 * The one retry: a token, the call; on "unauthorized" a FORCED fresh token and
 * the call once more. Never a third call. The caller decides what `dead` writes.
 */
export async function withOneRetry<TOk extends { ok: true }, TFail extends { ok: false }, R>(
  getToken: (force: boolean) => Promise<TOk | TFail>,
  call: (token: TOk) => Promise<R>,
  unauthorized: (result: R) => boolean,
): Promise<Retried<TOk, TFail, R>> {
  const first = await getToken(false);
  if (!first.ok) return { ok: false, failure: first as TFail };
  const r1 = await call(first as TOk);
  if (!unauthorized(r1)) return { ok: true, token: first as TOk, result: r1, attempts: 1, dead: false };
  const second = await getToken(true);
  if (!second.ok) return { ok: false, failure: second as TFail };
  const r2 = await call(second as TOk);
  return { ok: true, token: second as TOk, result: r2, attempts: 2, dead: unauthorized(r2) };
}

/** A refusal that is NOT about the connection, in our words — Google's status and `errors[].reason`. */
export const CALL_REFUSALS = {
  quota: { status: 429, error: 'YouTube’s daily limit for Edge Athlete is reached — try again tomorrow.' },
  upload_limit: { status: 403, error: 'YouTube says this channel has uploaded too many videos for now — try again later.' },
  refused: { status: 403, error: 'YouTube refused this for the channel.' },
  busy: { status: 503, error: 'YouTube did not answer — try again' },
} as const;
export type CallRefusal = keyof typeof CALL_REFUSALS;

const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded']);

export function callRefusalWord(status: number, reason: string | null | undefined): CallRefusal {
  if (reason && QUOTA_REASONS.has(reason)) return 'quota';
  if (status === 429) return 'quota';
  if (reason === 'uploadLimitExceeded') return 'upload_limit';
  return status === 403 ? 'refused' : 'busy';
}

/** The scope a Reconnect asks for: the widest the connection had (force-ssl covers uploads), so one yes restores everything. */
export function reconnectScope(scopes: readonly ScopeKey[] | null | undefined): ScopeKey {
  if (scopes?.includes('live')) return 'live';
  if (scopes?.includes('upload')) return 'upload';
  return 'readonly';
}

/** How often a card may ask YouTube whether its connection still stands. */
export const HEALTH_CHECK_EVERY_MS = 10 * 60_000;

export function healthCheckDue(lastCheckedAt: number | null | undefined, now: number): boolean {
  return typeof lastCheckedAt !== 'number' || !Number.isFinite(lastCheckedAt) || now - lastCheckedAt >= HEALTH_CHECK_EVERY_MS || lastCheckedAt > now;
}

// ── Google's duration ───────────────────────────────────────────────────────
/** ISO 8601 as `videos.list` writes it (`PT1H2M3S`, `P1DT2H`) → ms; null when it is not one. */
export function parseIsoDuration(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw.trim());
  if (!m || raw.trim() === 'P' || raw.trim() === 'PT') return null;
  const [, d, h, mi, s] = m;
  const ms = ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// ── What an upload session needs ────────────────────────────────────────────
export const UPLOAD_TITLE_MAX = 100; // YouTube's own limit
export const UPLOAD_DESCRIPTION_MAX = 5000; // YouTube's own limit
/** Google's resumable PUT takes chunks in multiples of 256 KiB; the last may be shorter. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
/** The Sports category on YouTube. */
export const YOUTUBE_SPORTS_CATEGORY = '17';

export interface UploadSessionInput {
  title: string;
  description: string;
  privacy: UploadPrivacy;
  sizeBytes: number;
  contentType: string;
}

export function parseUploadSessionBody(body: unknown): { ok: true; value: UploadSessionInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > UPLOAD_TITLE_MAX) return { ok: false, error: `A title of 1–${UPLOAD_TITLE_MAX} characters is required` };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length > UPLOAD_DESCRIPTION_MAX) return { ok: false, error: `The description is over ${UPLOAD_DESCRIPTION_MAX} characters` };
  const privacy = parseUploadPrivacy(b.privacy);
  if (!privacy) return { ok: false, error: 'The privacy must be public, unlisted or private' };
  const sizeBytes = typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes) && b.sizeBytes > 0 ? Math.floor(b.sizeBytes) : 0;
  if (!sizeBytes) return { ok: false, error: 'The file is empty' };
  const contentType = typeof b.contentType === 'string' && /^video\/[a-z0-9.+-]+$/i.test(b.contentType) ? b.contentType.toLowerCase() : '';
  if (!contentType) return { ok: false, error: 'The file is not a video' };
  return { ok: true, value: { title, description, privacy, sizeBytes, contentType } };
}

/** The next chunk's `Content-Range` for Google's resumable PUT: `bytes start-end/size`. */
export function youtubeContentRange(size: number, offset: number): { start: number; end: number; header: string } | null {
  if (!Number.isFinite(size) || !Number.isFinite(offset) || offset < 0 || offset >= size) return null;
  const end = Math.min(size, offset + YOUTUBE_CHUNK_BYTES);
  return { start: offset, end, header: `bytes ${offset}-${end - 1}/${size}` };
}

/** A 308's `Range: bytes=0-N` → the next offset (N + 1); no header = nothing stored yet. */
export function nextOffsetFromRange(header: string | null | undefined): number {
  if (!header) return 0;
  const m = /bytes=0-(\d+)/.exec(header);
  return m ? Number(m[1]) + 1 : 0;
}

// ── Phase 4b: the broadcast created from Edge Athlete ───────────────────────
export interface BroadcastInput {
  title: string;
  /** ISO — at least a minute ahead, within a year. */
  scheduledStartAt: string;
  privacy: UploadPrivacy;
}

export const BROADCAST_MIN_LEAD_MS = 60_000;
export const BROADCAST_MAX_LEAD_MS = 365 * 24 * 3600_000;

/** POST /api/videos/youtube/broadcast's body. */
export function parseBroadcastBody(body: unknown, now = Date.now()): { ok: true; value: BroadcastInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > UPLOAD_TITLE_MAX) return { ok: false, error: `A title of 1–${UPLOAD_TITLE_MAX} characters is required` };
  const at = typeof b.scheduledStartAt === 'string' ? Date.parse(b.scheduledStartAt) : NaN;
  if (Number.isNaN(at)) return { ok: false, error: 'Pick when the broadcast starts' };
  if (at - now < BROADCAST_MIN_LEAD_MS) return { ok: false, error: 'The start must be at least a minute from now' };
  if (at - now > BROADCAST_MAX_LEAD_MS) return { ok: false, error: 'The start must be within a year' };
  const privacy = parseUploadPrivacy(b.privacy);
  if (!privacy) return { ok: false, error: 'The privacy must be public, unlisted or private' };
  return { ok: true, value: { title, scheduledStartAt: new Date(at).toISOString(), privacy } };
}

/** The channel's eligibility, in our words — Google's `errors[].reason` → a word → a sentence. Never a stack trace. */
export const BROADCAST_ERRORS = {
  not_enabled: 'Turn on live streaming for this channel in YouTube Studio first — it takes up to a day.',
  blocked: 'YouTube is not letting this channel stream right now.',
  refused: 'YouTube refused to create the broadcast for this channel.',
  failed: 'YouTube did not create the broadcast — try again.',
} as const;
export type BroadcastErrorWord = keyof typeof BROADCAST_ERRORS;

export function broadcastErrorWord(status: number, reason: string | null | undefined): BroadcastErrorWord {
  if (reason === 'liveStreamingNotEnabled') return 'not_enabled';
  if (reason === 'livePermissionBlocked' || reason === 'insufficientLivePermissions') return 'blocked';
  return status === 403 ? 'refused' : 'failed';
}

/** YouTube Studio's live page for the broadcast — where the key can be read again; we never store it. */
export function studioUrlFor(videoId: string): string {
  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/livestreaming`;
}

/** The next full hour, as `<input type="datetime-local">` wants it (the viewer's clock). */
export function defaultBroadcastStart(now: Date = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Paste and go (Nov 6 2026): what YouTube says about a pasted id ───────────
export interface VideoLookup {
  available: boolean;
  title: string | null;
  thumbnail: string | null;
  durationMs: number | null;
  privacy: string | null;
  /** YouTube's `status.embeddable`; null when the read did not say. */
  embeddable: boolean | null;
  live: { status: 'none' | 'upcoming' | 'live' | 'ended'; scheduledStartAt: string | null } | null;
  chapters: Chapter[];
}

export interface Chapter { startMs: number; label: string }

/** The sentences the flow and the page say about a looked-up video. */
export const LOOKUP_NOTES = {
  private: 'This video is private on YouTube — make it unlisted or public first, or it will play for nobody here.',
  no_embed: 'Embedding is turned off for this video on YouTube — it will open on YouTube instead of playing here.',
} as const;
export type LookupRefusal = keyof typeof LOOKUP_NOTES;

/** `private` refuses the link; `no_embed` lets it through with the sentence; null = plays here. */
export function lookupRefusal(l: Pick<VideoLookup, 'available' | 'privacy' | 'embeddable'> | null | undefined): LookupRefusal | null {
  if (!l || !l.available) return null;
  if (l.privacy === 'private') return 'private';
  if (l.embeddable === false) return 'no_embed';
  return null;
}

/** YouTube's own rule for chapters in a description: a timestamp at a line start, the first at 0:00, ascending, at least three, at least ten seconds apart. */
export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_GAP_MS = 10_000;
export const CHAPTER_MAX_COUNT = 100;
const CHAPTER_LINE = /^\s*(?:[-•*]\s*)?(?:\(?\[?)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\]?\)?)\s*[-–—:|·]?\s*(.+?)\s*$/;

function timestampToMs(ts: string): number | null {
  const parts = ts.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return null;
  const [a, b, c] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (b > 59 || c > 59) return null;
  return ((a * 60 + b) * 60 + c) * 1000;
}

export function parseChapters(description: string | null | undefined): Chapter[] {
  if (!description) return [];
  const out: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = CHAPTER_LINE.exec(line);
    if (!m) continue;
    const startMs = timestampToMs(m[1]);
    const label = m[2].replace(/\s+/g, ' ').trim();
    if (startMs === null || !label) continue;
    out.push({ startMs, label: label.slice(0, HIGHLIGHT_LABEL_MAX_FOR_CHAPTERS) });
    if (out.length >= CHAPTER_MAX_COUNT) break;
  }
  if (out.length < CHAPTER_MIN_COUNT || out[0].startMs !== 0) return [];
  for (let i = 1; i < out.length; i++) if (out[i].startMs - out[i - 1].startMs < CHAPTER_MIN_GAP_MS) return [];
  return out;
}
const HIGHLIGHT_LABEL_MAX_FOR_CHAPTERS = 120; // rules.ts HIGHLIGHT_LABEL_MAX — a literal here keeps this module at one type import

/** A chapter becomes a marker from its start to the next chapter's start; the last one runs to the end (open when the duration is unknown). */
export function chaptersToHighlights(chapters: readonly Chapter[], durationMs: number | null): Array<{ start_ms: number; end_ms: number | null; label: string }> {
  return chapters.map((c, i) => {
    const next = chapters[i + 1]?.startMs ?? (durationMs && durationMs > c.startMs ? durationMs : null);
    return { start_ms: c.startMs, end_ms: next !== null && next > c.startMs ? next : null, label: c.label };
  });
}
