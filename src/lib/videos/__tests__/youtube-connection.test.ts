import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  accessTokenFresh, BROADCAST_ERRORS, chaptersToHighlights, lookupRefusal, parseChapters, broadcastErrorWord, CONNECT_ERRORS, defaultBroadcastStart, parseBroadcastBody, studioUrlFor, expiresAtFrom, hasScope, isScopeKey, isYouTubeSecret, mergeGrantedScopes, nextOffsetFromRange,
  ownerColumns, ownerRef, parseIsoDuration, parseOwnerRef, parseUploadPrivacy, parseUploadSessionBody, problemFor, projectConnection,
  returnPathFor, scopeKeysOf, scopesFor, secretContextFor, uploadsPlaylistFor, TOKEN_REFRESH_SKEW_MS, YOUTUBE_CHUNK_BYTES, YOUTUBE_SCOPES, youtubeContentRange,
  CALL_REFUSALS, callRefusalWord, HEALTH_CHECK_EVERY_MS, healthCheckDue, reconnectScope, TOKEN_FAILURES, tokenFailureFor, withOneRetry,
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
    // Self-healing (Nov 10 2026): only `revoked` ends a connection — an `error` row keeps its doors and heals on the next good call.
    expect(projectConnection({ ...row, status: 'error' }, { userId: 'u1', canManage: true, available: true })).toMatchObject({ canUpload: true, canBroadcast: true });
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

describe('paste and go — the chapters and the refusal', () => {
  const desc = ['Club final, full game', '0:00 Warm-up', '12:30 Kick-off', '1:02:05 - Second half', '[1:45:00] Final whistle', 'Thanks for watching'].join('\n');
  it('a timestamp at a line start, the first at 0:00, ascending, at least three, ten seconds apart — else nothing', () => {
    expect(parseChapters(desc)).toEqual([
      { startMs: 0, label: 'Warm-up' },
      { startMs: 750_000, label: 'Kick-off' },
      { startMs: 3_725_000, label: 'Second half' },
      { startMs: 6_300_000, label: 'Final whistle' },
    ]);
    expect(parseChapters('0:00 a\n0:05 b\n1:00 c')).toEqual([]); // too close
    expect(parseChapters('0:10 a\n1:00 b\n2:00 c')).toEqual([]); // the first is not 0:00
    expect(parseChapters('0:00 a\n2:00 b\n1:00 c')).toEqual([]); // not ascending
    expect(parseChapters('0:00 a\n1:00 b')).toEqual([]); // fewer than three
    expect(parseChapters('see 1:00 for the goal')).toEqual([]); // not at the line start
    expect(parseChapters(null)).toEqual([]);
  });
  it('a chapter runs to the next one; the last runs to the end, or stays open without a duration', () => {
    const c = parseChapters(desc);
    expect(chaptersToHighlights(c, 7_200_000).map(h => [h.start_ms, h.end_ms])).toEqual([[0, 750_000], [750_000, 3_725_000], [3_725_000, 6_300_000], [6_300_000, 7_200_000]]);
    expect(chaptersToHighlights(c, null)[3].end_ms).toBeNull();
    expect(chaptersToHighlights(c, 6_000_000)[3].end_ms).toBeNull(); // a duration shorter than the chapter: open
  });
  it('private refuses, embedding off lets through with the sentence, anything else (or no lookup) is silent', () => {
    expect(lookupRefusal({ available: true, privacy: 'private', embeddable: true })).toBe('private');
    expect(lookupRefusal({ available: true, privacy: 'unlisted', embeddable: false })).toBe('no_embed');
    expect(lookupRefusal({ available: true, privacy: 'public', embeddable: true })).toBeNull();
    expect(lookupRefusal({ available: false, privacy: 'private', embeddable: false })).toBeNull();
    expect(lookupRefusal(null)).toBeNull();
  });
});

describe('the module', () => {
  it('imports one type only (the org kind), as rules.ts does', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/videos/youtube-connection.ts'), 'utf8');
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual([`import type { OrgKind } from '@/lib/orgs/org-ref';`]);
  });
});

// Self-healing (Nov 10 2026): a 401 is a stale token first, a dead connection only when a fresh token is refused too.
describe('self-healing', () => {
  type Tok = { ok: true; accessToken: string };
  type Fail = { ok: false; why: string };
  type Res = { ok: true; value: string } | { ok: false; unauthorized: boolean };
  const unauthorized = (r: Res) => !r.ok && r.unauthorized;
  const harness = (tokens: Array<Tok | Fail>, answers: Res[]) => {
    const forced: boolean[] = [];
    const used: string[] = [];
    return {
      forced, used,
      run: () => withOneRetry<Tok, Fail, Res>(
        async force => { forced.push(force); return tokens.shift() as Tok | Fail; },
        async t => { used.push(t.accessToken); return answers.shift() as Res; },
        unauthorized,
      ),
    };
  };

  it('a call that works is one token and one call — never a forced refresh', async () => {
    const h = harness([{ ok: true, accessToken: 'a1' }], [{ ok: true, value: 'x' }]);
    expect(await h.run()).toMatchObject({ ok: true, attempts: 1, dead: false, result: { ok: true, value: 'x' } });
    expect(h.forced).toEqual([false]);
    expect(h.used).toEqual(['a1']);
  });
  it('a 401 is answered with ONE forced fresh token and one more call, which stands', async () => {
    const h = harness([{ ok: true, accessToken: 'stale' }, { ok: true, accessToken: 'fresh' }], [{ ok: false, unauthorized: true }, { ok: true, value: 'x' }]);
    expect(await h.run()).toMatchObject({ ok: true, attempts: 2, dead: false, token: { accessToken: 'fresh' }, result: { ok: true } });
    expect(h.forced).toEqual([false, true]);
    expect(h.used).toEqual(['stale', 'fresh']);
  });
  it('a 401 on the fresh token too is `dead` — and there is never a third call', async () => {
    const h = harness([{ ok: true, accessToken: 'a' }, { ok: true, accessToken: 'b' }, { ok: true, accessToken: 'c' }], [{ ok: false, unauthorized: true }, { ok: false, unauthorized: true }, { ok: true, value: 'never' }]);
    expect(await h.run()).toMatchObject({ ok: true, attempts: 2, dead: true });
    expect(h.used).toEqual(['a', 'b']);
  });
  it('a refusal that is not a 401 (a quota, a 5xx, no answer) is returned as it is — no retry, nothing dead', async () => {
    const h = harness([{ ok: true, accessToken: 'a' }], [{ ok: false, unauthorized: false }]);
    expect(await h.run()).toMatchObject({ ok: true, attempts: 1, dead: false, result: { ok: false } });
    expect(h.forced).toEqual([false]);
  });
  it('no token at all, or a forced refresh that fails, is the token\'s own failure — the call is not made (again)', async () => {
    const none = harness([{ ok: false, why: 'none' }], []);
    expect(await none.run()).toEqual({ ok: false, failure: { ok: false, why: 'none' } });
    expect(none.used).toEqual([]);
    const busy = harness([{ ok: true, accessToken: 'a' }, { ok: false, why: 'busy' }], [{ ok: false, unauthorized: true }]);
    expect(await busy.run()).toEqual({ ok: false, failure: { ok: false, why: 'busy' } });
    expect(busy.used).toEqual(['a']);
  });

  it('why there is no token: no row, a revoked row, a box that cannot be read — an `error` row still opens', () => {
    expect(tokenFailureFor(null, false)).toBe('none');
    expect(tokenFailureFor({ status: 'revoked' }, false)).toBe('revoked');
    expect(tokenFailureFor({ status: 'revoked' }, true)).toBe('revoked');
    expect(tokenFailureFor({ status: 'active' }, false)).toBe('unreadable');
    expect(tokenFailureFor({ status: 'active' }, true)).toBeNull();
    expect(tokenFailureFor({ status: 'error' }, true)).toBeNull();
  });
  it('only the failures a reconnect fixes offer Reconnect; "no channel" is a 404, never "reconnect"', () => {
    expect(TOKEN_FAILURES.none).toMatchObject({ status: 404, reconnect: false });
    expect(TOKEN_FAILURES.revoked).toMatchObject({ status: 409, reconnect: true });
    expect(TOKEN_FAILURES.unreadable).toMatchObject({ status: 409, reconnect: true });
    expect(TOKEN_FAILURES.busy).toMatchObject({ status: 503, reconnect: false });
    expect(TOKEN_FAILURES.unavailable).toMatchObject({ status: 503, reconnect: false });
    for (const f of Object.values(TOKEN_FAILURES)) expect(f.error.length).toBeGreaterThan(10);
  });
  it('Google\'s refusals in our words: the quota is not "try again", a 403 is not "did not answer"', () => {
    expect(callRefusalWord(403, 'quotaExceeded')).toBe('quota');
    expect(callRefusalWord(403, 'dailyLimitExceeded')).toBe('quota');
    expect(callRefusalWord(429, null)).toBe('quota');
    expect(callRefusalWord(400, 'uploadLimitExceeded')).toBe('upload_limit');
    expect(callRefusalWord(403, 'forbidden')).toBe('refused');
    expect(callRefusalWord(403, null)).toBe('refused');
    expect(callRefusalWord(500, null)).toBe('busy');
    expect(callRefusalWord(0, null)).toBe('busy');
    expect(CALL_REFUSALS.quota.status).toBe(429);
    expect(CALL_REFUSALS.quota.error).toMatch(/tomorrow/);
  });
  it('a Reconnect asks the widest scope the connection had; the health check is due after ten minutes, at once when never asked or the clock went back', () => {
    expect(reconnectScope(['readonly'])).toBe('readonly');
    expect(reconnectScope(['readonly', 'upload'])).toBe('upload');
    expect(reconnectScope(['readonly', 'upload', 'live'])).toBe('live');
    expect(reconnectScope(null)).toBe('readonly');
    const now = 1_800_000_000_000;
    expect(healthCheckDue(null, now)).toBe(true);
    expect(healthCheckDue(Number.NaN, now)).toBe(true);
    expect(healthCheckDue(now - 1000, now)).toBe(false);
    expect(healthCheckDue(now - HEALTH_CHECK_EVERY_MS, now)).toBe(true);
    expect(healthCheckDue(now + 5000, now)).toBe(true);
  });
  it('the writer: every call to YouTube goes through callWithToken; nothing writes `error`; only two places write `revoked`', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
    const server = read('src/lib/videos/youtube-connections-server.ts');
    expect(server).toContain('export async function callWithToken<');
    expect(server).not.toContain("status: 'error'");
    expect(server).not.toContain('recordError');
    expect(server.match(/await markRevoked\(/g)).toHaveLength(2);
    expect(server).toContain("if (out.result.ok && row.status === 'error')");
    for (const f of [
      'src/app/api/videos/youtube/channel-uploads/route.ts',
      'src/app/api/videos/youtube/upload-session/route.ts',
      'src/app/api/videos/youtube/broadcast/route.ts',
      'src/app/api/videos/youtube/lookup/route.ts',
      'src/app/api/videos/[id]/refresh/route.ts',
      'src/lib/videos/videos-live-server.ts',
    ]) {
      const src = read(f);
      expect(src, f).toContain('callWithToken(');
      expect(src, f).not.toMatch(/withAccessToken|recordError/);
    }
    const route = read('src/app/api/videos/youtube/connection/route.ts');
    expect(route).toContain("searchParams.get('check') === '1'");
    expect(route).toContain("enforceRateLimit(request, 'video-lookup'");
  });
});
