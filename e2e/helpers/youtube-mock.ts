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

/** What the local test server is started with. */
export const YOUTUBE_E2E_ENV: Record<string, string> = {
  YOUTUBE_CLIENT_ID: YOUTUBE_E2E_CLIENT.id,
  YOUTUBE_CLIENT_SECRET: YOUTUBE_E2E_CLIENT.secret,
  YOUTUBE_MOCK_BASE,
};

export interface MockChannel {
  id: string;
  title: string;
  uploads: Array<{ videoId: string; title: string; publishedAt: string; durationIso: string }>;
}

export interface YouTubeMock {
  /** The Google account the NEXT consent screen signs in; null = an account with no channel. */
  signInAs(channel: MockChannel | null): void;
  /** The consent screen says no. */
  deny(on: boolean): void;
  /** The refresh token stops working (consent withdrawn / the Testing week ran out). */
  revokeRefresh(on: boolean): void;
  /** The scopes the consent screen granted (defaults to what was asked). */
  grantedScopes: string[] | null;
  /** Requests received, as "METHOD /path". */
  calls: string[];
  /** The uploads the mock received, by video id: the bytes' size and the snippet. */
  uploaded: Map<string, { size: number; title: string; privacy: string; contentType: string }>;
  /** Access tokens minted so far (the refresh count). */
  tokensMinted(): number;
  close(): Promise<void>;
}

export async function startYouTubeMock(): Promise<YouTubeMock> {
  let current: MockChannel | null = null;
  let denying = false;
  let refreshRevoked = false;
  const codes = new Map<string, { challenge: string; scope: string; channel: MockChannel | null }>();
  const sessions = new Map<string, { size: number; received: number; title: string; privacy: string; contentType: string; chunks: Buffer[] }>();
  const uploaded = new Map<string, { size: number; title: string; privacy: string; contentType: string }>();
  const calls: string[] = [];
  let seq = 0;
  let minted = 0;
  const mock: YouTubeMock = {
    signInAs: c => { current = c; },
    deny: on => { denying = on; },
    revokeRefresh: on => { refreshRevoked = on; },
    grantedScopes: null,
    calls,
    uploaded,
    tokensMinted: () => minted,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };

  const send = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
    if (body === undefined) { res.writeHead(status, headers); res.end(); return; }
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<Buffer>(resolve => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(c as Buffer)); req.on('end', () => resolve(Buffer.concat(chunks))); });
  const bearerOk = (req: IncomingMessage) => /^Bearer yt-access-\d+$/.test(req.headers.authorization ?? '');
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
          return send(res, 200, { access_token: `yt-access-${minted}`, refresh_token: `yt-refresh-${minted}`, expires_in: 3599, scope: entry.scope, token_type: 'Bearer' });
        }
        if (form.get('grant_type') === 'refresh_token') {
          if (refreshRevoked || !/^yt-refresh-\d+$/.test(form.get('refresh_token') ?? '')) return send(res, 400, { error: 'invalid_grant' });
          minted += 1;
          return send(res, 200, { access_token: `yt-access-${minted}`, expires_in: 3599, scope: '', token_type: 'Bearer' });
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }
      if (req.method === 'POST' && url.pathname === '/revoke') return send(res, 200, {});

      // The resumable PUTs carry the session id in the path.
      const put = /^\/upload\/session\/(\d+)$/.exec(url.pathname);
      if (req.method === 'PUT' && put) {
        const s = sessions.get(put[1]);
        if (!s) return send(res, 404, { error: 'no session' });
        const bytes = await readBody(req);
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range'] as string ?? '');
        if (!range || Number(range[1]) !== s.received || Number(range[3]) !== s.size) return send(res, 400, { error: 'bad range' });
        s.chunks.push(bytes);
        s.received += bytes.length;
        if (s.received < s.size) return send(res, 308, undefined, { Range: `bytes=0-${s.received - 1}` });
        const id = `e2e${put[1].padStart(8, '0')}`.slice(0, 11);
        uploaded.set(id, { size: s.received, title: s.title, privacy: s.privacy, contentType: s.contentType });
        return send(res, 200, { id, kind: 'youtube#video' });
      }

      if (!bearerOk(req)) return send(res, 401, { error: { code: 401, message: 'unauthorized' } });
      const ch = channelOf();

      if (req.method === 'GET' && url.pathname === '/youtube/v3/channels') {
        if (!ch) return send(res, 200, { items: [] });
        return send(res, 200, { items: [{ id: ch.id, snippet: { title: ch.title }, contentDetails: { relatedPlaylists: { uploads: `UU${ch.id.slice(2)}` } } }] });
      }
      if (req.method === 'GET' && url.pathname === '/youtube/v3/playlistItems') {
        if (!ch || url.searchParams.get('playlistId') !== `UU${ch.id.slice(2)}`) return send(res, 404, { error: { code: 404 } });
        return send(res, 200, { items: ch.uploads.map(u => ({ snippet: { title: u.title, thumbnails: { high: { url: `https://i.ytimg.com/vi/${u.videoId}/hqdefault.jpg` } } }, contentDetails: { videoId: u.videoId, videoPublishedAt: u.publishedAt } })) });
      }
      if (req.method === 'GET' && url.pathname === '/youtube/v3/videos') {
        const id = url.searchParams.get('id') ?? '';
        const u = ch?.uploads.find(x => x.videoId === id);
        const up = uploaded.get(id);
        if (!u && !up) return send(res, 200, { items: [] });
        return send(res, 200, { items: [{ id, contentDetails: { duration: u?.durationIso ?? 'PT1M30S' }, snippet: { title: u?.title ?? up?.title, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } }, status: { privacyStatus: up?.privacy ?? 'public' } }] });
      }
      if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') {
        if (!ch) return send(res, 403, { error: { code: 403, message: 'no channel' } });
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { snippet?: { title?: string }; status?: { privacyStatus?: string } };
        const size = Number(req.headers['x-upload-content-length']);
        if (!Number.isFinite(size) || size <= 0) return send(res, 400, { error: 'bad length' });
        const id = String(++seq);
        sessions.set(id, { size, received: 0, title: body.snippet?.title ?? '', privacy: body.status?.privacyStatus ?? 'private', contentType: String(req.headers['x-upload-content-type'] ?? ''), chunks: [] });
        return send(res, 200, undefined, { Location: `${YOUTUBE_MOCK_BASE}/upload/session/${id}` });
      }
      return send(res, 404, { error: 'not_found' });
    })();
  });
  await new Promise<void>(resolve => server.listen(YOUTUBE_MOCK_PORT, '127.0.0.1', resolve));
  return mock;
}
