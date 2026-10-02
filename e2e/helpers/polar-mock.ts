import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// A stand-in for Polar AccessLink (e2e/polar.spec.ts). It speaks exactly the
// calls src/lib/activities/providers/polar-server.ts makes — the consent
// page's redirect, the token exchange, user registration, the exercise list,
// a FIT download, a summary, de-registration — so the whole connection can
// be proven without Polar's hosts or a real account. The LOCAL test server
// is pointed here by playwright.config.ts (POLAR_MOCK_BASE); a production
// deployment ignores that variable.

export const POLAR_MOCK_PORT = 4871;
export const POLAR_MOCK_BASE = `http://127.0.0.1:${POLAR_MOCK_PORT}`;
export const POLAR_E2E_CLIENT = { id: 'e2e-polar-client', secret: 'e2e-polar-secret', webhookSecret: 'e2e-polar-webhook-secret' };

/** What the local test server is started with. */
export const POLAR_E2E_ENV: Record<string, string> = {
  POLAR_CLIENT_ID: POLAR_E2E_CLIENT.id,
  POLAR_CLIENT_SECRET: POLAR_E2E_CLIENT.secret,
  POLAR_WEBHOOK_SECRET: POLAR_E2E_CLIENT.webhookSecret,
  POLAR_MOCK_BASE,
};

export interface MockExercise {
  id: string;
  /** The FIT Polar would return; null = Polar has no FIT (the summary is used). */
  fit: Buffer | null;
  summary: Record<string, unknown>;
}

export interface PolarMock {
  /** The Polar account the NEXT consent screen signs in. */
  signInAs(userId: number): void;
  /** What an athlete has at Polar. */
  setExercises(userId: number, exercises: MockExercise[]): void;
  /** The athlete withdrew consent at Polar: their token now answers 401. */
  revoke(userId: number, revoked: boolean): void;
  /** Requests received, as "METHOD /path". */
  calls: string[];
  /** The URL the client registered its webhook for, once it has. */
  webhookUrl(): string | null;
  close(): Promise<void>;
}

const tokenFor = (userId: number) => `polar-token-${userId}`;

export async function startPolarMock(): Promise<PolarMock> {
  let nextUser = 0;
  const codes = new Map<string, number>();
  const exercises = new Map<number, MockExercise[]>();
  const revoked = new Set<number>();
  const calls: string[] = [];
  let seq = 0;
  let webhookUrl: string | null = null;

  const send = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
    if (body instanceof Buffer) {
      res.writeHead(status, { 'Content-Type': 'application/octet-stream', ...headers });
      res.end(body);
    } else if (body === undefined) {
      res.writeHead(status, headers);
      res.end();
    } else {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    }
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>(resolve => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c as Buffer));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  const userOf = (req: IncomingMessage): number | null => {
    const m = /^Bearer polar-token-(\d+)$/.exec(req.headers.authorization ?? '');
    return m ? Number(m[1]) : null;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', POLAR_MOCK_BASE);
      calls.push(`${req.method} ${url.pathname}`);

      // The consent screen: Polar would ask the athlete; the stand-in says yes.
      if (req.method === 'GET' && url.pathname === '/oauth2/authorization') {
        const redirect = url.searchParams.get('redirect_uri');
        if (url.searchParams.get('client_id') !== POLAR_E2E_CLIENT.id || url.searchParams.get('response_type') !== 'code' || !redirect) {
          return send(res, 400, { error: 'invalid_request' });
        }
        const code = `code-${++seq}`;
        codes.set(code, nextUser);
        const back = new URL(redirect);
        back.searchParams.set('code', code);
        const state = url.searchParams.get('state');
        if (state) back.searchParams.set('state', state);
        return send(res, 302, undefined, { Location: back.toString() });
      }

      if (req.method === 'POST' && url.pathname === '/v2/oauth2/token') {
        const expected = `Basic ${Buffer.from(`${POLAR_E2E_CLIENT.id}:${POLAR_E2E_CLIENT.secret}`).toString('base64')}`;
        if (req.headers.authorization !== expected) return send(res, 401, { error: 'invalid_client' });
        const form = new URLSearchParams(await readBody(req));
        const userId = codes.get(form.get('code') ?? '');
        if (form.get('grant_type') !== 'authorization_code' || userId === undefined) return send(res, 400, { error: 'invalid_grant' });
        codes.delete(form.get('code')!); // a code is good once
        return send(res, 200, { access_token: tokenFor(userId), token_type: 'bearer', expires_in: 315_360_000, x_user_id: userId });
      }

      // The client's own call (Basic auth): create THE webhook. One per client.
      if (req.method === 'POST' && url.pathname === '/v3/webhooks') {
        const expected = `Basic ${Buffer.from(`${POLAR_E2E_CLIENT.id}:${POLAR_E2E_CLIENT.secret}`).toString('base64')}`;
        if (req.headers.authorization !== expected) return send(res, 401, { error: 'invalid_client' });
        const body = JSON.parse((await readBody(req)) || '{}') as { events?: string[]; url?: string };
        if (webhookUrl) return send(res, 409, { error: 'webhook exists' });
        webhookUrl = body.url ?? null;
        return send(res, 201, { data: { id: 'wh-1', events: body.events, url: body.url, signature_secret_key: POLAR_E2E_CLIENT.webhookSecret } });
      }

      const userId = userOf(req);
      if (userId === null || revoked.has(userId)) return send(res, 401, { error: 'unauthorized' });

      if (req.method === 'POST' && url.pathname === '/v3/users') {
        await readBody(req);
        return send(res, 200, { 'polar-user-id': userId });
      }
      if (req.method === 'DELETE' && url.pathname === `/v3/users/${userId}`) {
        revoked.add(userId);
        return send(res, 204);
      }
      if (req.method === 'GET' && url.pathname === '/v3/exercises') {
        return send(res, 200, (exercises.get(userId) ?? []).map(e => ({ id: e.id, ...e.summary })));
      }
      const one = /^\/v3\/exercises\/([A-Za-z0-9_-]+)(\/fit)?$/.exec(url.pathname);
      if (req.method === 'GET' && one) {
        const ex = (exercises.get(userId) ?? []).find(e => e.id === one[1]);
        if (!ex) return send(res, 404, { error: 'not_found' });
        if (one[2]) return ex.fit ? send(res, 200, ex.fit) : send(res, 204);
        return send(res, 200, { id: ex.id, ...ex.summary });
      }
      return send(res, 404, { error: 'not_found' });
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(POLAR_MOCK_PORT, '127.0.0.1', () => resolve());
  });

  return {
    signInAs: userId => { nextUser = userId; },
    setExercises: (userId, list) => { exercises.set(userId, list); },
    revoke: (userId, on) => { if (on) revoked.add(userId); else revoked.delete(userId); },
    calls,
    webhookUrl: () => webhookUrl,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
