import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// A stand-in for Google's OAuth and the YouTube Data API (e2e/youtube-connect.spec.ts).
// It speaks exactly the calls src/lib/videos/google-youtube-server.ts makes —
// the consent screen's redirect (PKCE checked on the exchange), the token
// exchange, the refresh, the revoke, the channel read, the uploads playlist,
// one video's details, and the resumable upload session with its PUTs — so
// the whole connection and a device upload can be proven without Google's
// hosts or a real channel. The LOCAL test server is pointed here by
// playwright.config.ts (YOUTUBE_MOCK_BASE); a production deployment ignores it.

export const YOUTUBE_MOCK_PORT = 4872;
export const YOUTUBE_MOCK_BASE = `http://127.0.0.1:${YOUTUBE_MOCK_PORT}`;
export const YOUTUBE_E2E_CLIENT = { id: 'e2e-youtube-client', secret: 'e2e-youtube-secret' };
/** The server-only Data API key (Phase 4a): public reads of a video's live state. */
export const YOUTUBE_E2E_API_KEY = 'e2e-youtube-key';
/** Only the connected channel (Nov 11): the channel a video belongs to when nothing says otherwise (no account signed in, no entry in `videoChannels`). */
export const MOCK_DEFAULT_CHANNEL = 'UCe2eDefaultAbcdefghijkl';

/** What the local test server is started with. */
export const YOUTUBE_E2E_ENV: Record<string, string> = {
  YOUTUBE_CLIENT_ID: YOUTUBE_E2E_CLIENT.id,
  YOUTUBE_CLIENT_SECRET: YOUTUBE_E2E_CLIENT.secret,
  YOUTUBE_MOCK_BASE,
  YOUTUBE_API_KEY: YOUTUBE_E2E_API_KEY,
};

/** Phase 4a: what `videos.list` says about one id's broadcast state. */
export interface MockLive {
  content: 'upcoming' | 'live' | 'none';
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  durationIso?: string;
  title?: string;
  /** Paste and go: the description (chapters live in it), whether the video embeds, its privacy. */
  description?: string;
  embeddable?: boolean;
  privacy?: string;
}

export interface MockChannel {
  id: string;
  title: string;
  uploads: Array<{ videoId: string; title: string; publishedAt: string; durationIso: string }>;
}

export interface YouTubeMock {
  /**
   * Only the connected channel (Nov 11): `videos.list` says whose a video is (`snippet.channelId`) — this map's answer
   * first, else the signed-in account's channel, else MOCK_DEFAULT_CHANNEL. An id listed here that is no upload, no
   * broadcast and no app upload is answered as a plain public video (a spec's pasted link).
   */
  videoChannels: Map<string, string>;
  /** The Google account the NEXT consent screen signs in; null = an account with no channel. */
  signInAs(channel: MockChannel | null): void;
  /** The consent screen says no. */
  deny(on: boolean): void;
  /** The refresh token stops working (consent withdrawn / the Testing week ran out). */
  revokeRefresh(on: boolean): void;
  /** Self-healing (Nov 10): every access token minted SO FAR answers 401 from now on — a refresh mints one that works. */
  expireAccess(): void;
  /** Self-healing: every bearer call answers 401, a brand-new token included (the grant is gone though the refresh still answers). */
  refuseAll(on: boolean): void;
  /**
   * The uploads round (Nov 10): faults for the device's resumable PUTs, each fired ONCE on the data chunk with that
   * index (0-based, counted per session). `unauthorized` answers 401 until the PUT carries a DIFFERENT token (the
   * hour ran out); `drop` cuts the connection (a tunnel); `stall` takes the bytes and never answers (the page is
   * about to reload) — none of the three stores the chunk.
   */
  uploadFaults: { unauthorized: number | null; drop: number | null; stall: number | null };
  /** The faults that fired, in order. */
  faultsFired: string[];
  /** The start offsets of the chunks each session STORED, by session id ("1", "2", …). */
  storedStarts: Map<string, number[]>;
  /** The scopes the consent screen granted (defaults to what was asked). */
  grantedScopes: string[] | null;
  /** Requests received, as "METHOD /path". */
  calls: string[];
  /** The uploads the mock received, by video id: the bytes' size and the snippet. */
  uploaded: Map<string, { size: number; title: string; privacy: string; contentType: string }>;
  /** Phase 4a: the live state per video id (a key-only read answers these too). */
  live: Map<string, MockLive>;
  /** Phase 4a: every videos.list answers 403 quotaExceeded while on. */
  quota(on: boolean): void;
  /** Phase 4b: the channel's live eligibility — the 403 reasons liveBroadcasts.insert answers. */
  liveEligibility: 'ok' | 'not_enabled' | 'blocked';
  /** Phase 4b: the broadcasts created, by video id. */
  broadcasts: Map<string, { title: string; scheduledStartTime: string; privacy: string; streamId: string | null }>;
  /** Phase 4b: the streams created, by id — the key the route handed out once. */
  streams: Map<string, { key: string; title: string }>;
  /** Access tokens minted so far (the refresh count). */
  tokensMinted(): number;
  close(): Promise<void>;
}

export async function startYouTubeMock(): Promise<YouTubeMock> {
  let current: MockChannel | null = null;
  let denying = false;
  let refreshRevoked = false;
  const codes = new Map<string, { challenge: string; scope: string; channel: MockChannel | null }>();
  const sessions = new Map<string, { size: number; received: number; title: string; privacy: string; contentType: string; chunks: Buffer[]; puts: number; refusedToken: string | null }>();
  const storedStarts = new Map<string, number[]>();
  const faultsFired: string[] = [];
  const uploaded = new Map<string, { size: number; title: string; privacy: string; contentType: string }>();
  const calls: string[] = [];
  let seq = 0;
  let minted = 0;
  let quotaOut = false;
  let expiredThrough = 0;
  let refusingAll = false;
  const live = new Map<string, MockLive>();
  const videoChannels = new Map<string, string>();
  // Phase 4b: which scopes each token carries (the force-ssl scope gates the live writes).
  const tokenScope = new Map<string, string>();
  const refreshScope = new Map<string, string>();
  const broadcasts = new Map<string, { title: string; scheduledStartTime: string; privacy: string; streamId: string | null }>();
  const streams = new Map<string, { key: string; title: string }>();
  const mock: YouTubeMock = {
    signInAs: c => { current = c; },
    videoChannels,
    deny: on => { denying = on; },
    revokeRefresh: on => { refreshRevoked = on; },
    expireAccess: () => { expiredThrough = minted; },
    uploadFaults: { unauthorized: null, drop: null, stall: null },
    faultsFired,
    storedStarts,
    refuseAll: on => { refusingAll = on; },
    grantedScopes: null,
    calls,
    uploaded,
    live,
    quota: on => { quotaOut = on; },
    liveEligibility: 'ok',
    broadcasts,
    streams,
    tokensMinted: () => minted,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };

  const send = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
    if (body === undefined) { res.writeHead(status, headers); res.end(); return; }
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<Buffer>(resolve => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(c as Buffer)); req.on('end', () => resolve(Buffer.concat(chunks))); });
  const bearerOk = (req: IncomingMessage) => {
    const m = /^Bearer yt-access-(\d+)$/.exec(req.headers.authorization ?? '');
    return !!m && !refusingAll && Number(m[1]) > expiredThrough;
  };
  const channelOf = (): MockChannel | null => current;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', YOUTUBE_MOCK_BASE);
      calls.push(`${req.method} ${url.pathname}`);

      // The consent screen.
      if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
        const redirect = url.searchParams.get('redirect_uri');
        const challenge = url.searchParams.get('code_challenge');
        if (url.searchParams.get('client_id') !== YOUTUBE_E2E_CLIENT.id || url.searchParams.get('response_type') !== 'code' || !redirect || !challenge || url.searchParams.get('code_challenge_method') !== 'S256' || url.searchParams.get('access_type') !== 'offline') {
          return send(res, 400, { error: 'invalid_request' });
        }
        const back = new URL(redirect);
        const state = url.searchParams.get('state');
        if (state) back.searchParams.set('state', state);
        if (denying) { back.searchParams.set('error', 'access_denied'); return send(res, 302, undefined, { Location: back.toString() }); }
        const code = `code-${++seq}`;
        codes.set(code, { challenge, scope: (mock.grantedScopes ?? (url.searchParams.get('scope') ?? '').split(' ')).join(' '), channel: channelOf() });
        back.searchParams.set('code', code);
        return send(res, 302, undefined, { Location: back.toString() });
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const form = new URLSearchParams((await readBody(req)).toString('utf8'));
        if (form.get('client_id') !== YOUTUBE_E2E_CLIENT.id || form.get('client_secret') !== YOUTUBE_E2E_CLIENT.secret) return send(res, 401, { error: 'invalid_client' });
        if (form.get('grant_type') === 'authorization_code') {
          const entry = codes.get(form.get('code') ?? '');
          const verifier = form.get('code_verifier') ?? '';
          if (!entry || createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) return send(res, 400, { error: 'invalid_grant' });
          codes.delete(form.get('code')!);
          current = entry.channel;
          minted += 1;
          tokenScope.set(`yt-access-${minted}`, entry.scope);
          refreshScope.set(`yt-refresh-${minted}`, entry.scope);
          return send(res, 200, { access_token: `yt-access-${minted}`, refresh_token: `yt-refresh-${minted}`, expires_in: 3599, scope: entry.scope, token_type: 'Bearer' });
        }
        if (form.get('grant_type') === 'refresh_token') {
          if (refreshRevoked || !/^yt-refresh-\d+$/.test(form.get('refresh_token') ?? '')) return send(res, 400, { error: 'invalid_grant' });
          minted += 1;
          tokenScope.set(`yt-access-${minted}`, refreshScope.get(form.get('refresh_token') ?? '') ?? '');
          return send(res, 200, { access_token: `yt-access-${minted}`, expires_in: 3599, scope: '', token_type: 'Bearer' });
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }
      if (req.method === 'POST' && url.pathname === '/revoke') return send(res, 200, {});

      // The resumable PUTs carry the session id in the path.
      const put = /^\/upload\/session\/(\d+)$/.exec(url.pathname);
      // A BROWSER sends these (the uploads round): the session answers the app's origin, as Google's does for the Origin a session was opened with.
      const cors: Record<string, string> = put && req.headers.origin
        ? { 'Access-Control-Allow-Origin': String(req.headers.origin), 'Access-Control-Expose-Headers': 'Range', Vary: 'Origin' }
        : {};
      if (req.method === 'OPTIONS' && put) {
        return send(res, 204, undefined, { ...cors, 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'authorization, content-range, content-type', 'Access-Control-Max-Age': '600' });
      }
      if (req.method === 'PUT' && put) {
        const s = sessions.get(put[1]);
        if (!s) return send(res, 404, { error: 'no session' }, cors);
        const bytes = await readBody(req);
        const header = req.headers['content-range'] as string ?? '';
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        const stored = () => (s.received > 0 ? { ...cors, Range: `bytes=0-${s.received - 1}` } : cors);
        // "How much do you hold?" — `bytes */size`, no body.
        if (/^bytes \*\/\d+$/.test(header)) {
          if (s.refusedToken && token === s.refusedToken) return send(res, 401, { error: { code: 401 } }, cors);
          return send(res, 308, undefined, stored());
        }
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header);
        if (!range || Number(range[1]) !== s.received || Number(range[3]) !== s.size) return send(res, 400, { error: 'bad range' }, cors);
        const index = s.puts++;
        const f = mock.uploadFaults;
        if (s.refusedToken && token === s.refusedToken) { s.puts--; return send(res, 401, { error: { code: 401 } }, cors); }
        if (f.unauthorized === index) { f.unauthorized = null; s.puts--; s.refusedToken = token; faultsFired.push('unauthorized'); return send(res, 401, { error: { code: 401 } }, cors); }
        if (f.drop === index) { f.drop = null; s.puts--; faultsFired.push('drop'); req.socket.destroy(); return; }
        if (f.stall === index) { f.stall = null; s.puts--; faultsFired.push('stall'); return; }
        s.chunks.push(bytes);
        storedStarts.set(put[1], [...(storedStarts.get(put[1]) ?? []), s.received]);
        s.received += bytes.length;
        if (s.received < s.size) return send(res, 308, undefined, stored());
        const id = `e2e${put[1].padStart(8, '0')}`.slice(0, 11);
        uploaded.set(id, { size: s.received, title: s.title, privacy: s.privacy, contentType: s.contentType });
        return send(res, 200, { id, kind: 'youtube#video' }, cors);
      }

      const videosList = (chan: MockChannel | null) => {
        if (quotaOut) return send(res, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } });
        const id = url.searchParams.get('id') ?? '';
        const u = chan?.uploads.find(x => x.videoId === id);
        const up = uploaded.get(id);
        const lv = live.get(id);
        if (!u && !up && !lv && !videoChannels.has(id)) return send(res, 200, { items: [] });
        const channelId = videoChannels.get(id) ?? (u ? chan?.id : current?.id) ?? MOCK_DEFAULT_CHANNEL;
        const details = lv ? { ...(lv.scheduledStartTime ? { scheduledStartTime: lv.scheduledStartTime } : {}), ...(lv.actualStartTime ? { actualStartTime: lv.actualStartTime } : {}), ...(lv.actualEndTime ? { actualEndTime: lv.actualEndTime } : {}) } : null;
        return send(res, 200, { items: [{
          id,
          contentDetails: { duration: lv && lv.content !== 'none' ? 'PT0S' : (lv?.durationIso ?? u?.durationIso ?? 'PT1M30S') },
          snippet: { channelId, title: lv?.title ?? u?.title ?? up?.title ?? 'Broadcast', description: lv?.description ?? '', liveBroadcastContent: lv?.content ?? 'none', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
          status: { privacyStatus: lv?.privacy ?? up?.privacy ?? 'public', embeddable: lv?.embeddable ?? true },
          ...(details ? { liveStreamingDetails: details } : {}),
        }] });
      };
      // Phase 4a: the server-only key reads a public video's state without a person's token.
      if (req.method === 'GET' && url.pathname === '/youtube/v3/videos' && url.searchParams.get('key')) {
        if (url.searchParams.get('key') !== YOUTUBE_E2E_API_KEY) return send(res, 400, { error: { code: 400, message: 'bad key' } });
        return videosList(null);
      }

      if (!bearerOk(req)) return send(res, 401, { error: { code: 401, message: 'unauthorized' } });
      const ch = channelOf();

      if (req.method === 'GET' && url.pathname === '/youtube/v3/channels') {
        if (!ch) return send(res, 200, { items: [] });
        return send(res, 200, { items: [{ id: ch.id, snippet: { title: ch.title }, contentDetails: { relatedPlaylists: { uploads: `UU${ch.id.slice(2)}` } } }] });
      }
      if (req.method === 'GET' && url.pathname === '/youtube/v3/playlistItems') {
        if (quotaOut) return send(res, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } });
        if (!ch || url.searchParams.get('playlistId') !== `UU${ch.id.slice(2)}`) return send(res, 404, { error: { code: 404 } });
        return send(res, 200, { items: ch.uploads.map(u => ({ snippet: { title: u.title, thumbnails: { high: { url: `https://i.ytimg.com/vi/${u.videoId}/hqdefault.jpg` } } }, contentDetails: { videoId: u.videoId, videoPublishedAt: u.publishedAt } })) });
      }
      if (req.method === 'GET' && url.pathname === '/youtube/v3/videos') return videosList(ch);
      if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') {
        if (!ch) return send(res, 403, { error: { code: 403, message: 'no channel' } });
        // Correct state (Nov 10): the upload needs the upload scope ON THIS TOKEN — force-ssl covers it, as at Google.
        const uploadScope = tokenScope.get((req.headers.authorization ?? '').replace(/^Bearer /, '')) ?? '';
        if (!/youtube\.upload|youtube\.force-ssl|\/auth\/youtube(\s|$)/.test(uploadScope)) return send(res, 403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions', domain: 'global' }] } });
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { snippet?: { title?: string }; status?: { privacyStatus?: string } };
        const size = Number(req.headers['x-upload-content-length']);
        if (!Number.isFinite(size) || size <= 0) return send(res, 400, { error: 'bad length' });
        const id = String(++seq);
        sessions.set(id, { size, received: 0, title: body.snippet?.title ?? '', privacy: body.status?.privacyStatus ?? 'private', contentType: String(req.headers['x-upload-content-type'] ?? ''), chunks: [], puts: 0, refusedToken: null });
        if (req.headers.origin) calls.push(`ORIGIN ${String(req.headers.origin)}`);
        return send(res, 200, undefined, { Location: `${YOUTUBE_MOCK_BASE}/upload/session/${id}` });
      }

      // Phase 4b: the live writes — the force-ssl scope on THIS token, then the channel's eligibility.
      const isLiveWrite = /^\/youtube\/v3\/(liveBroadcasts|liveStreams)(\/bind)?$/.test(url.pathname);
      if (isLiveWrite) {
        const scope = tokenScope.get((req.headers.authorization ?? '').replace(/^Bearer /, '')) ?? '';
        if (!/youtube\.force-ssl|\/auth\/youtube(\s|$)/.test(scope)) return send(res, 403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions', domain: 'global' }] } });
        if (!ch) return send(res, 403, { error: { code: 403, errors: [{ reason: 'liveStreamingNotEnabled', domain: 'youtube.liveBroadcast' }] } });
        if (mock.liveEligibility === 'not_enabled') return send(res, 403, { error: { code: 403, errors: [{ reason: 'liveStreamingNotEnabled', domain: 'youtube.liveBroadcast' }] } });
        if (mock.liveEligibility === 'blocked') return send(res, 403, { error: { code: 403, errors: [{ reason: 'livePermissionBlocked', domain: 'youtube.liveBroadcast' }] } });
        if (req.method === 'POST' && url.pathname === '/youtube/v3/liveBroadcasts') {
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { snippet?: { title?: string; scheduledStartTime?: string }; status?: { privacyStatus?: string } };
          if (!body.snippet?.title || !body.snippet.scheduledStartTime || !body.status?.privacyStatus) return send(res, 400, { error: { code: 400, errors: [{ reason: 'invalidRequest' }] } });
          const id = `e2eLive${String(++seq).padStart(4, '0')}`.slice(0, 11);
          broadcasts.set(id, { title: body.snippet.title, scheduledStartTime: body.snippet.scheduledStartTime, privacy: body.status.privacyStatus, streamId: null });
          live.set(id, { content: 'upcoming', scheduledStartTime: body.snippet.scheduledStartTime, title: body.snippet.title });
          return send(res, 200, { id, kind: 'youtube#liveBroadcast', snippet: body.snippet, status: { ...body.status, lifeCycleStatus: 'created' } });
        }
        if (req.method === 'POST' && url.pathname === '/youtube/v3/liveStreams') {
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { snippet?: { title?: string } };
          const id = `stream-${++seq}`;
          const key = `e2e-stream-key-${seq}-${Math.random().toString(36).slice(2, 8)}`;
          streams.set(id, { key, title: body.snippet?.title ?? '' });
          return send(res, 200, { id, kind: 'youtube#liveStream', cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable', ingestionInfo: { streamName: key, ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', rtmpsIngestionAddress: 'rtmps://a.rtmps.youtube.com/live2' } } });
        }
        if (req.method === 'POST' && url.pathname === '/youtube/v3/liveBroadcasts/bind') {
          const b = broadcasts.get(url.searchParams.get('id') ?? '');
          const sid = url.searchParams.get('streamId') ?? '';
          if (!b || !streams.has(sid)) return send(res, 404, { error: { code: 404, errors: [{ reason: 'liveBroadcastNotFound' }] } });
          b.streamId = sid;
          return send(res, 200, { id: url.searchParams.get('id'), kind: 'youtube#liveBroadcast' });
        }
        if (req.method === 'DELETE' && url.pathname === '/youtube/v3/liveBroadcasts') {
          const id = url.searchParams.get('id') ?? '';
          broadcasts.delete(id);
          live.delete(id);
          return send(res, 204);
        }
      }
      return send(res, 404, { error: 'not_found' });
    })();
  });
  await new Promise<void>(resolve => server.listen(YOUTUBE_MOCK_PORT, '127.0.0.1', resolve));
  return mock;
}

/**
 * Navigate to a connect start URL and answer where the callback LANDED — the
 * final response's URL. The screens read the result words once and then
 * remove them from the address (the flow round, Nov 10 2026), so a spec
 * reads the landing itself, never `page.url()` a moment later.
 */
export async function landingOf(page: { goto(url: string): Promise<{ url(): string } | null>; url(): string }, startUrl: string): Promise<string> {
  const res = await page.goto(startUrl);
  return res?.url() ?? page.url();
}

