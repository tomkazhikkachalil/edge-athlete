import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runYouTubeUpload, type ChunkAnswer, type UploadTransport } from '../youtube-upload';
import {
  chunkRetryable, parseYouTubeResume, resumeMatches, UPLOAD_RETRY_MAX, UPLOAD_TOKEN_REFRESH_MAX, uploadBackoffMs, YOUTUBE_CHUNK_BYTES, YT_RESUME_TTL_MS, youtubeResumeKey,
  type YouTubeResumeEntry,
} from '../youtube-connection';
import { isHydrationKey } from '@/lib/net/hydration-rules';

// The uploads round (Nov 10 2026): a full game outlives the hour, the tunnel and a reload.
// The loop runs here over a scripted wire — no DOM, no clock.

const CHUNK = YOUTUBE_CHUNK_BYTES;
const SIZE = CHUNK * 2 + 1000; // three chunks
const DONE: ChunkAnswer = { status: 200, range: null, body: JSON.stringify({ id: 'abcdefghijk' }) };
const stored = (bytes: number): ChunkAnswer => ({ status: 308, range: bytes > 0 ? `bytes=0-${bytes - 1}` : null, body: '' });

type Step = ChunkAnswer | 'network' | 'abort';

function wire(script: { puts: Step[]; asks?: Step[]; online?: boolean[] }) {
  const log: string[] = [];
  const waits: Array<{ ms: number; forOnline: boolean }> = [];
  const next = (list: Step[], what: string): Promise<ChunkAnswer> => {
    const step = list.shift();
    if (step === undefined) throw new Error(`the script has no more ${what}`);
    return typeof step === 'string' ? Promise.reject(step) : Promise.resolve(step);
  };
  const t: UploadTransport = {
    put: (range, token) => { log.push(`put ${range.start} ${token}`); return next(script.puts, 'puts'); },
    ask: token => { log.push(`ask ${token}`); return next(script.asks ?? [], 'asks'); },
    wait: (ms, forOnline) => { waits.push({ ms, forOnline }); return Promise.resolve(); },
    online: () => script.online?.shift() ?? true,
  };
  return { t, log, waits };
}

describe('the upload loop', () => {
  it('a clean upload: chunk after chunk from YouTube\'s own offsets, the id at the end, no wait and no question', async () => {
    const w = wire({ puts: [stored(CHUNK), stored(CHUNK * 2), DONE] });
    const progress: number[] = [];
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't1', onProgress: f => progress.push(f) }, w.t)).toEqual({ ok: true, videoId: 'abcdefghijk' });
    expect(w.log).toEqual(['put 0 t1', `put ${CHUNK} t1`, `put ${CHUNK * 2} t1`]);
    expect(w.waits).toEqual([]);
    expect(progress.at(-1)).toBe(1);
  });

  it('the hour ran out (a 401 mid-upload): ONE fresh token from the server, YouTube\'s own offset, and on — no byte sent twice', async () => {
    const w = wire({ puts: [stored(CHUNK), { status: 401, range: null, body: '' }, stored(CHUNK * 2), DONE], asks: [stored(CHUNK)] });
    let asked = 0;
    const out = await runYouTubeUpload({ size: SIZE, accessToken: 'old', refreshToken: async () => { asked += 1; return 'new'; } }, w.t);
    expect(out).toEqual({ ok: true, videoId: 'abcdefghijk' });
    expect(asked).toBe(1);
    expect(w.log).toEqual(['put 0 old', `put ${CHUNK} old`, 'ask new', `put ${CHUNK} new`, `put ${CHUNK * 2} new`]);
  });

  it('a 401 with no way to renew, or a server that has no token to give, says reconnect — never "check your connection"', async () => {
    const none = wire({ puts: [{ status: 401, range: null, body: '' }] });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't' }, none.t)).toMatchObject({ ok: false, kind: 'refused', reconnect: true });
    const refused = wire({ puts: [{ status: 401, range: null, body: '' }] });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', refreshToken: async () => null }, refused.t)).toMatchObject({ ok: false, kind: 'refused', reconnect: true });
  });

  it('a token that is refused again and again stops at the limit — never a loop', async () => {
    const puts: Step[] = Array.from({ length: UPLOAD_TOKEN_REFRESH_MAX + 2 }, () => ({ status: 401, range: null, body: '' }));
    const asks: Step[] = Array.from({ length: UPLOAD_TOKEN_REFRESH_MAX + 2 }, () => stored(0));
    const w = wire({ puts, asks });
    let asked = 0;
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', refreshToken: async () => `t${++asked}` }, w.t)).toMatchObject({ ok: false, reconnect: true });
    expect(asked).toBe(UPLOAD_TOKEN_REFRESH_MAX);
  });

  it('the connection drops mid-chunk: it waits, asks YouTube where it is, and continues from THERE (YouTube kept half the chunk)', async () => {
    const half = CHUNK + 4 * 1024 * 1024;
    const w = wire({ puts: [stored(CHUNK), 'network', stored(CHUNK * 2), DONE], asks: [stored(half)] });
    const retries: number[] = [];
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', onRetry: i => retries.push(i.failures) }, w.t)).toEqual({ ok: true, videoId: 'abcdefghijk' });
    expect(w.log).toEqual(['put 0 t', `put ${CHUNK} t`, 'ask t', `put ${half} t`, `put ${CHUNK * 2} t`]);
    expect(w.waits).toEqual([{ ms: 1000, forOnline: false }]);
    expect(retries).toEqual([1]);
  });

  it('offline: the wait is for the connection, and the screen is told so', async () => {
    const w = wire({ puts: ['network', DONE], asks: [stored(0)], online: [false] });
    const seen: boolean[] = [];
    expect((await runYouTubeUpload({ size: 1000, accessToken: 't', onRetry: i => seen.push(i.offline) }, w.t)).ok).toBe(true);
    expect(w.waits).toEqual([{ ms: 1000, forOnline: true }]);
    expect(seen).toEqual([true]);
  });

  it('a 5xx, a 429 and a timeout are tries, not the end; a stored chunk resets the count; the waits grow', async () => {
    const w = wire({
      puts: [{ status: 503, range: null, body: '' }, { status: 429, range: null, body: '' }, stored(CHUNK), { status: 500, range: null, body: '' }, stored(CHUNK * 2), DONE],
      asks: [stored(0), stored(0), stored(CHUNK)],
    });
    expect((await runYouTubeUpload({ size: SIZE, accessToken: 't' }, w.t)).ok).toBe(true);
    expect(w.waits.map(x => x.ms)).toEqual([1000, 2000, 1000]); // the third wait is after a stored chunk: the count started over
  });

  it('nothing answers, again and again: it gives up after the limit with "resume it" — the session is not thrown away', async () => {
    const w = wire({ puts: ['network'], asks: Array.from({ length: UPLOAD_RETRY_MAX + 1 }, () => 'network' as Step) });
    const out = await runYouTubeUpload({ size: SIZE, accessToken: 't' }, w.t);
    expect(out).toMatchObject({ ok: false, kind: 'network' });
    expect(out.ok === false && out.message).toMatch(/resume/);
    expect(w.waits).toHaveLength(UPLOAD_RETRY_MAX);
    expect(Math.max(...w.waits.map(x => x.ms))).toBe(30_000);
  });

  it('a resume after a reload starts by ASKING: from YouTube\'s offset, or straight to the id when it already holds everything', async () => {
    const w = wire({ puts: [stored(CHUNK * 2), DONE], asks: [stored(CHUNK)] });
    expect((await runYouTubeUpload({ size: SIZE, accessToken: 't', resume: true }, w.t)).ok).toBe(true);
    expect(w.log).toEqual(['ask t', `put ${CHUNK} t`, `put ${CHUNK * 2} t`]);
    const whole = wire({ puts: [], asks: [DONE] });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', resume: true }, whole.t)).toEqual({ ok: true, videoId: 'abcdefghijk' });
    const fresh = wire({ puts: [DONE], asks: [stored(0)] });
    expect((await runYouTubeUpload({ size: 1000, accessToken: 't', resume: true }, fresh.t)).ok).toBe(true);
    expect(fresh.log).toEqual(['ask t', 'put 0 t']);
  });

  it('a session YouTube no longer has (404 / 410) is "start again", on a chunk or on the question; a resume with a dead token renews first', async () => {
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't' }, wire({ puts: [{ status: 404, range: null, body: '' }] }).t)).toMatchObject({ ok: false, kind: 'expired' });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', resume: true }, wire({ puts: [], asks: [{ status: 410, range: null, body: '' }] }).t)).toMatchObject({ ok: false, kind: 'expired' });
    const w = wire({ puts: [DONE], asks: [{ status: 401, range: null, body: '' }, stored(0)] });
    expect((await runYouTubeUpload({ size: 1000, accessToken: 'dead', resume: true, refreshToken: async () => 'live' }, w.t)).ok).toBe(true);
    expect(w.log).toEqual(['ask dead', 'ask live', 'put 0 live']);
  });

  it('cancel is cancel wherever it lands — before a chunk, in one, in a question; a 403 is the channel\'s refusal; a 308 that stores nothing is a failure, not progress', async () => {
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', aborted: () => true }, wire({ puts: [] }).t)).toMatchObject({ kind: 'cancelled' });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't' }, wire({ puts: ['abort'] }).t)).toMatchObject({ kind: 'cancelled' });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't', resume: true }, wire({ puts: [], asks: ['abort'] }).t)).toMatchObject({ kind: 'cancelled' });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't' }, wire({ puts: [{ status: 403, range: null, body: '' }] }).t)).toMatchObject({ kind: 'refused', message: expect.stringContaining('channel') });
    const stuck = wire({ puts: Array.from({ length: UPLOAD_RETRY_MAX + 1 }, () => stored(0)) });
    expect(await runYouTubeUpload({ size: SIZE, accessToken: 't' }, stuck.t)).toMatchObject({ ok: false, kind: 'network' });
    expect(await runYouTubeUpload({ size: 1000, accessToken: 't' }, wire({ puts: [{ status: 200, range: null, body: '{}' }] }).t)).toMatchObject({ ok: false, kind: 'refused' });
  });
});

describe('the upload\'s rules', () => {
  it('the backoff doubles from a second to thirty; what is worth another try', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(uploadBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(uploadBackoffMs(0)).toBe(1000);
    for (const s of [0, 408, 429, 500, 502, 503, 599]) expect(chunkRetryable(s), String(s)).toBe(true);
    for (const s of [200, 308, 400, 401, 403, 404, 410]) expect(chunkRetryable(s), String(s)).toBe(false);
  });
  it('what the device keeps of an upload: the session and the file\'s fingerprint, 23 hours, never a token — under the key every sign-out clears', () => {
    const now = 1_800_000_000_000;
    const entry: YouTubeResumeEntry = { sessionUri: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc', owner: 'profile:11111111-1111-4111-8111-111111111111', title: 'Final', name: 'final.mp4', size: 5_000_000_000, lastModified: 1_799_000_000_000, type: 'video/mp4', at: now - 60_000 };
    expect(parseYouTubeResume(JSON.stringify(entry), now)).toEqual(entry);
    expect(Object.keys(entry).join(' ')).not.toMatch(/token|secret/i);
    expect(parseYouTubeResume(JSON.stringify({ ...entry, accessToken: 'x' }), now)).toEqual(entry); // an extra field never rides along
    expect(parseYouTubeResume(JSON.stringify({ ...entry, at: now - YT_RESUME_TTL_MS - 1 }), now)).toBeNull();
    expect(parseYouTubeResume(JSON.stringify({ ...entry, at: now + 1000 }), now)).toBeNull();
    expect(parseYouTubeResume(JSON.stringify({ ...entry, sessionUri: 'javascript:alert(1)' }), now)).toBeNull();
    expect(parseYouTubeResume(JSON.stringify({ ...entry, owner: 'profile:nope' }), now)).toBeNull();
    expect(parseYouTubeResume(JSON.stringify({ ...entry, size: 0 }), now)).toBeNull();
    expect(parseYouTubeResume('{broken', now)).toBeNull();
    expect(parseYouTubeResume(null, now)).toBeNull();
    const file = { name: 'final.mp4', size: 5_000_000_000, lastModified: 1_799_000_000_000 };
    expect(resumeMatches(entry, file, entry.owner)).toBe(true);
    expect(resumeMatches(entry, { ...file, size: 4 }, entry.owner)).toBe(false);
    expect(resumeMatches(entry, { ...file, name: 'other.mp4' }, entry.owner)).toBe(false);
    expect(resumeMatches(entry, { ...file, lastModified: 1 }, entry.owner)).toBe(false);
    expect(resumeMatches(entry, file, 'club:22222222-2222-4222-8222-222222222222')).toBe(false);
    expect(resumeMatches(null, file, entry.owner)).toBe(false);
    expect(resumeMatches(entry, null, entry.owner)).toBe(false);
    expect(isHydrationKey(youtubeResumeKey('user-1'))).toBe(true);
    expect(youtubeResumeKey('user-1')).not.toBe(youtubeResumeKey('user-2'));
  });
  it('the fresh-token route has the session route\'s gates and forces the refresh; the session is opened in the app\'s origin\'s name; the panel keeps awake and guards the exit', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
    const route = read('src/app/api/videos/youtube/upload-token/route.ts');
    expect(route).toContain("requireActiveWriter(request, { limit: 'video-write' })");
    expect(route).toContain('await uploadRight(admin, owner, user.id)');
    expect(route).toContain("scopeAllows(right.value.scopes, 'upload')");
    expect(route).toContain('withAccessToken(admin, cfg, owner, { force: true })');
    expect(route).not.toMatch(/refreshToken|secret/);
    expect(read('src/lib/videos/google-youtube-server.ts')).toContain('...(origin ? { Origin: origin } : {}),');
    expect(read('src/app/api/videos/youtube/upload-session/route.ts')).toContain("request.headers.get('origin') || new URL(request.url).origin");
    const panel = read('src/components/videos/YouTubeUploadPanel.tsx');
    expect(panel).toContain('useWakeLock(uploading)');
    expect(panel).toContain("window.addEventListener('beforeunload', warn)");
    expect(panel).toContain('/api/videos/youtube/upload-token');
    expect(panel).toContain('refreshToken: freshToken');
    expect(panel).toContain("data-youtube-upload-start={resumable ? 'resume' : 'new'}");
    expect(panel).not.toMatch(/setItem\([^)]*access/i);
    const up = read('src/lib/videos/youtube-upload.ts');
    expect(up).not.toMatch(/supabase|fetch\(/);
  });
});
