import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  accessTokenFresh, BROADCAST_ERRORS, broadcastErrorWord, CONNECT_ERRORS, defaultBroadcastStart, parseBroadcastBody, studioUrlFor, expiresAtFrom, hasScope, isScopeKey, isYouTubeSecret, mergeGrantedScopes, nextOffsetFromRange,
  ownerColumns, ownerRef, parseIsoDuration, parseOwnerRef, parseUploadPrivacy, parseUploadSessionBody, problemFor, projectConnection,
  returnPathFor, scopeKeysOf, scopesFor, secretContextFor, uploadsPlaylistFor, TOKEN_REFRESH_SKEW_MS, YOUTUBE_CHUNK_BYTES, YOUTUBE_SCOPES, youtubeContentRange,
  type YouTubeConnectionRow,
} from '../youtube-connection';

// Videos program Phase 3 (Nov 5 2026): the connection's vocabulary and projection.

const P = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';
const row: YouTubeConnectionRow = { id: 'c1', profile_id: P, org_id: null, connected_by_user_id: 'u1', channel_id: 'UCabc', channel_title: 'Tom’s Golf', scopes: [YOUTUBE_SCOPES.readonly], status: 'active', last_error: null, connected_at: '2026-11-05T00:00:00Z' };

describe('scopes', () => {
  it('readonly alone at connect; upload adds to it; granted lists merge into our two, stable and once', () => {
    expect(scopesFor('readonly')).toEqual([YOUTUBE_SCOPES.readonly]);
    expect(scopesFor('upload')).toEqual([YOUTUBE_SCOPES.readonly, YOUTUBE_SCOPES.upload]);
    expect(scopeKeysOf([YOUTUBE_SCOPES.upload, YOUTUBE_SCOPES.readonly, 'https://www.googleapis.com/auth/userinfo.email'])).toEqual(['readonly', 'upload']);
    expect(scopeKeysOf(null)).toEqual([]);
    expect(hasScope([YOUTUBE_SCOPES.readonly], 'upload')).toBe(false);
    expect(mergeGrantedScopes([YOUTUBE_SCOPES.readonly], `${YOUTUBE_SCOPES.upload} openid ${YOUTUBE_SCOPES.readonly}`)).toEqual([YOUTUBE_SCOPES.readonly, YOUTUBE_SCOPES.upload]);
    expect(mergeGrantedScopes(null, undefined)).toEqual([]);
    expect(isScopeKey('upload')).toBe(true);
    expect(isScopeKey('all')).toBe(false);
    // Phase 4b: the third incremental scope, force-ssl (sensitive), asked only when a broadcast is scheduled.
    expect(YOUTUBE_SCOPES.live).toBe('https://www.googleapis.com/auth/youtube.force-ssl');
    expect(scopesFor('live')).toEqual([YOUTUBE_SCOPES.readonly, YOUTUBE_SCOPES.live]);
    expect(scopeKeysOf([YOUTUBE_SCOPES.live, YOUTUBE_SCOPES.readonly, YOUTUBE_SCOPES.upload])).toEqual(['readonly', 'upload', 'live']);
    expect(isScopeKey('live')).toBe(true);
  });
});

describe('the owner', () => {
  it('profile:<uuid> | club:<uuid> | league:<uuid> round-trip; anything else is null', () => {
    expect(parseOwnerRef(`profile:${P}`)).toEqual({ kind: 'profile', profileId: P });
    expect(parseOwnerRef(`club:${O}`)).toEqual({ kind: 'org', side: 'club', orgId: O });
    expect(parseOwnerRef(`league:${O}`)).toEqual({ kind: 'org', side: 'league', orgId: O });
    expect(parseOwnerRef(`team:${O}`)).toBeNull();
    expect(parseOwnerRef(`profile:${P}:x`)).toBeNull();
    expect(parseOwnerRef('profile:not-a-uuid')).toBeNull();
    expect(parseOwnerRef(null)).toBeNull();
    expect(ownerRef({ kind: 'profile', profileId: P })).toBe(`profile:${P}`);
    expect(ownerRef({ kind: 'org', side: 'club', orgId: O })).toBe(`club:${O}`);
    expect(ownerColumns({ kind: 'profile', profileId: P })).toEqual({ profile_id: P, org_id: null });
    expect(ownerColumns({ kind: 'org', side: 'league', orgId: O })).toEqual({ profile_id: null, org_id: O });
    expect(secretContextFor({ kind: 'profile', profileId: P })).toBe(`youtube_connections:profile:${P}`);
  });
  it('the uploads playlist is UC → UU; anything else null', () => {
    expect(uploadsPlaylistFor('UCabcdefghijklmnopqrstuv')).toBe('UUabcdefghijklmnopqrstuv');
    expect(uploadsPlaylistFor('UCshort')).toBeNull();
    expect(uploadsPlaylistFor('HCabcdefghijklmnopqrstuv')).toBeNull();
  });
  it('the way back is the owner’s Videos surface', () => {
    expect(returnPathFor({ kind: 'profile', profileId: P }, 'youtube=connected')).toBe('/athlete?youtube=connected&tab=videos');
    expect(returnPathFor({ kind: 'org', side: 'club', orgId: O }, '')).toBe(`/app/org/club/${O}?section=website`);
  });
});

describe('the secret and the token', () => {
  it('a secret is a refresh token, an access token and an expiry; fresh = a minute or more left', () => {
    expect(isYouTubeSecret({ refreshToken: 'r', accessToken: 'a', expiresAt: 1 })).toBe(true);
    expect(isYouTubeSecret({ refreshToken: '', accessToken: 'a', expiresAt: 1 })).toBe(false);
    expect(isYouTubeSecret({ accessToken: 'a' })).toBe(false);
    expect(TOKEN_REFRESH_SKEW_MS).toBe(60_000);
    expect(accessTokenFresh({ expiresAt: 1_000_000 }, 1_000_000 - 61_000)).toBe(true);
    expect(accessTokenFresh({ expiresAt: 1_000_000 }, 1_000_000 - 60_000)).toBe(false);
    expect(expiresAtFrom(3599, 1_000)).toBe(1_000 + 3_599_000);
    expect(expiresAtFrom('3600', 1_000)).toBe(3_601_000);
    expect(expiresAtFrom(undefined, 1_000)).toBe(1_000);
    expect(expiresAtFrom(-5, 1_000)).toBe(1_000);
  });
});

describe('the projection', () => {
  it('never carries the secret; canUpload needs manage + the connector + active', () => {
    const mine = projectConnection(row, { userId: 'u1', canManage: true, available: true });
    expect(Object.keys(mine)).toEqual(['available', 'connected', 'channelId', 'channelTitle', 'scopes', 'status', 'connectedAt', 'connectedByMe', 'canManage', 'canUpload', 'canBroadcast', 'problem']);
    expect(mine).toMatchObject({ connected: true, channelId: 'UCabc', scopes: ['readonly'], connectedByMe: true, canUpload: true, problem: null });
    expect(projectConnection(row, { userId: 'u2', canManage: true, available: true })).toMatchObject({ connectedByMe: false, canUpload: false, canManage: true });
    expect(projectConnection({ ...row, status: 'revoked' }, { userId: 'u1', canManage: true, available: true })).toMatchObject({ canUpload: false, problem: expect.stringContaining('reconnect') });
    expect(projectConnection(null, { userId: 'u1', canManage: false, available: false })).toMatchObject({ available: false, connected: false, channelId: null, scopes: [], canUpload: false, problem: null });
    expect(problemFor({ status: 'error', last_error: 'quota' })).toBe('quota');
    expect(JSON.stringify(mine)).not.toMatch(/secret|cipher|token/i);
  });
  it('every connect_error word has a sentence', () => {
    for (const k of ['denied', 'expired', 'unavailable', 'busy', 'forbidden', 'limited', 'nochannel', 'failed']) expect(CONNECT_ERRORS[k]).toBeTruthy();
  });
});

describe('the upload words', () => {
  it('privacy is public | unlisted | private', () => {
    expect(parseUploadPrivacy('unlisted')).toBe('unlisted');
    expect(parseUploadPrivacy('friends')).toBeNull();
  });
  it('the session body: a title within YouTube’s 100, a description within 5000, a privacy, a size, a video type', () => {
    const ok = parseUploadSessionBody({ title: ' Final ', description: 'd', privacy: 'public', sizeBytes: 1234.7, contentType: 'VIDEO/MP4' });
    expect(ok).toEqual({ ok: true, value: { title: 'Final', description: 'd', privacy: 'public', sizeBytes: 1234, contentType: 'video/mp4' } });
    expect(parseUploadSessionBody({ title: 'x'.repeat(101), privacy: 'public', sizeBytes: 1, contentType: 'video/mp4' }).ok).toBe(false);
    expect(parseUploadSessionBody({ title: 't', privacy: 'public', sizeBytes: 0, contentType: 'video/mp4' }).ok).toBe(false);
    expect(parseUploadSessionBody({ title: 't', privacy: 'public', sizeBytes: 1, contentType: 'image/png' }).ok).toBe(false);
    expect(parseUploadSessionBody({ title: 't', privacy: 'secret', sizeBytes: 1, contentType: 'video/mp4' }).ok).toBe(false);
  });
  it('Google’s chunk is a 256 KiB multiple; Content-Range walks the file; a 308 Range gives the next offset', () => {
    expect(YOUTUBE_CHUNK_BYTES % (256 * 1024)).toBe(0);
    const size = YOUTUBE_CHUNK_BYTES + 10;
    expect(youtubeContentRange(size, 0)).toEqual({ start: 0, end: YOUTUBE_CHUNK_BYTES, header: `bytes 0-${YOUTUBE_CHUNK_BYTES - 1}/${size}` });
    expect(youtubeContentRange(size, YOUTUBE_CHUNK_BYTES)).toEqual({ start: YOUTUBE_CHUNK_BYTES, end: size, header: `bytes ${YOUTUBE_CHUNK_BYTES}-${size - 1}/${size}` });
    expect(youtubeContentRange(size, size)).toBeNull();
    expect(nextOffsetFromRange('bytes=0-262143')).toBe(262144);
    expect(nextOffsetFromRange(null)).toBe(0);
    expect(nextOffsetFromRange('garbage')).toBe(0);
  });
  it('ISO 8601 durations as videos.list writes them', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3_723_000);
    expect(parseIsoDuration('PT45S')).toBe(45_000);
    expect(parseIsoDuration('P1DT2H')).toBe(93_600_000);
    expect(parseIsoDuration('PT0S')).toBe(0);
    expect(parseIsoDuration('PT')).toBeNull();
    expect(parseIsoDuration('1:02:03')).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });
});

describe('the broadcast (Phase 4b)', () => {
  const now = Date.parse('2026-11-08T19:00:00.000Z');
  it('the body: a title within YouTube’s 100, a start at least a minute ahead and within a year, a privacy', () => {
    const ok = parseBroadcastBody({ title: ' Final ', scheduledStartAt: new Date(now + 3_600_000).toISOString(), privacy: 'unlisted' }, now);
    expect(ok).toEqual({ ok: true, value: { title: 'Final', scheduledStartAt: new Date(now + 3_600_000).toISOString(), privacy: 'unlisted' } });
    expect(parseBroadcastBody({ title: '', scheduledStartAt: new Date(now + 3_600_000).toISOString(), privacy: 'public' }, now).ok).toBe(false);
    expect(parseBroadcastBody({ title: 'x', scheduledStartAt: 'soon', privacy: 'public' }, now).ok).toBe(false);
    expect(parseBroadcastBody({ title: 'x', scheduledStartAt: new Date(now + 30_000).toISOString(), privacy: 'public' }, now).ok).toBe(false);
    expect(parseBroadcastBody({ title: 'x', scheduledStartAt: new Date(now + 400 * 24 * 3_600_000).toISOString(), privacy: 'public' }, now).ok).toBe(false);
    expect(parseBroadcastBody({ title: 'x', scheduledStartAt: new Date(now + 3_600_000).toISOString(), privacy: 'friends' }, now).ok).toBe(false);
  });
  it('the channel’s eligibility becomes a word with a sentence; Studio is where the key lives afterwards', () => {
    expect(broadcastErrorWord(403, 'liveStreamingNotEnabled')).toBe('not_enabled');
    expect(broadcastErrorWord(403, 'livePermissionBlocked')).toBe('blocked');
    expect(broadcastErrorWord(403, 'insufficientLivePermissions')).toBe('blocked');
    expect(broadcastErrorWord(403, 'forbidden')).toBe('refused');
    expect(broadcastErrorWord(503, null)).toBe('failed');
    for (const word of Object.keys(BROADCAST_ERRORS)) expect(BROADCAST_ERRORS[word as keyof typeof BROADCAST_ERRORS].length).toBeGreaterThan(20);
    expect(studioUrlFor('abc123DEF45')).toBe('https://studio.youtube.com/video/abc123DEF45/livestreaming');
  });
  it('the default start is the next full hour on the viewer’s clock, in the datetime-local shape', () => {
    const d = new Date(2026, 10, 8, 14, 23, 45);
    expect(defaultBroadcastStart(d)).toBe('2026-11-08T15:00');
    expect(defaultBroadcastStart(new Date(2026, 11, 31, 23, 5))).toBe('2027-01-01T00:00');
  });
  it('the projection’s canBroadcast is canUpload’s three facts', () => {
    const row = { id: 'c', profile_id: 'p', org_id: null, connected_by_user_id: 'u', channel_id: 'UCx', channel_title: 't', scopes: [YOUTUBE_SCOPES.readonly], status: 'active' as const, last_error: null, connected_at: '2026-11-05T00:00:00Z' };
    expect(projectConnection(row, { userId: 'u', canManage: true, available: true }).canBroadcast).toBe(true);
    expect(projectConnection(row, { userId: 'v', canManage: true, available: true }).canBroadcast).toBe(false);
    expect(projectConnection({ ...row, status: 'revoked' }, { userId: 'u', canManage: true, available: true }).canBroadcast).toBe(false);
  });
});

describe('the module', () => {
  it('imports one type only (the org kind), as rules.ts does', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/videos/youtube-connection.ts'), 'utf8');
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual([`import type { OrgKind } from '@/lib/orgs/org-ref';`]);
  });
});
