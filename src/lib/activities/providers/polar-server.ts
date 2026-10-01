// ── Polar AccessLink — the network half (fix round part 3, PR 4) ────────────
// SERVER ONLY. Every call Edge Athlete makes to Polar is in this file, so
// the hosts, the credentials and the timeouts have one owner.
//
//   POLAR_CLIENT_ID / POLAR_CLIENT_SECRET   the AccessLink client (Tom's)
//   POLAR_WEBHOOK_SECRET                    the signature key Polar returned
//                                           when the webhook was created
//
// Not configured → `polarConfig()` is null and every route answers "not
// available" (the Polar card reads "Coming soon"). Nothing is half-on.
//
// A URL is only ever built from OUR configured base plus an id that matched
// POLAR_ID_RE — never from a webhook's own `url` field.
//
// POLAR_MOCK_BASE points all three hosts at a local stand-in for the e2e
// suite. It is IGNORED in a production deployment (VERCEL_ENV=production):
// a stray value there could send an athlete's sign-in to another host.

import { POLAR_ID_RE, parsePolarExerciseList, type PolarExerciseListItem } from './polar';

export interface PolarConfig {
  clientId: string;
  clientSecret: string;
  webhookSecret: string | null;
  authBase: string;
  tokenBase: string;
  apiBase: string;
}

const HOSTS = {
  authBase: 'https://flow.polar.com',
  tokenBase: 'https://polarremote.com',
  apiBase: 'https://www.polaraccesslink.com',
};

const TIMEOUT_MS = 15_000;

export function polarConfig(env: Record<string, string | undefined> = process.env): PolarConfig | null {
  const clientId = env.POLAR_CLIENT_ID?.trim();
  const clientSecret = env.POLAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const mock = env.VERCEL_ENV === 'production' ? undefined : env.POLAR_MOCK_BASE?.trim().replace(/\/+$/, '');
  return {
    clientId,
    clientSecret,
    webhookSecret: env.POLAR_WEBHOOK_SECRET?.trim() || null,
    ...(mock ? { authBase: mock, tokenBase: mock, apiBase: mock } : HOSTS),
  };
}

async function call(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store', redirect: 'error' });
  } catch (e) {
    console.error('[polar] request failed:', new URL(url).pathname, e instanceof Error ? e.name : 'error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const basic = (cfg: PolarConfig) => `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`;
const bearer = (token: string) => `Bearer ${token}`;

/** Where the athlete is sent to give their consent at Polar. */
export function polarAuthorizeUrl(cfg: PolarConfig, opts: { state: string; redirectUri: string }): string {
  const u = new URL('/oauth2/authorization', cfg.authBase);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('scope', 'accesslink.read_all');
  u.searchParams.set('state', opts.state);
  return u.toString();
}

export type PolarToken = { ok: true; accessToken: string; userId: string } | { ok: false };

/** The code Polar handed back → the athlete's access token and Polar user id. */
export async function polarExchangeCode(cfg: PolarConfig, code: string, redirectUri: string): Promise<PolarToken> {
  const res = await call(`${cfg.tokenBase}/v2/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: basic(cfg), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json;charset=UTF-8' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
  });
  if (!res || !res.ok) return { ok: false };
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; x_user_id?: unknown } | null;
  const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
  const userId = typeof body?.x_user_id === 'number' || typeof body?.x_user_id === 'string' ? String(body.x_user_id) : '';
  if (!accessToken || !POLAR_ID_RE.test(userId)) return { ok: false };
  return { ok: true, accessToken, userId };
}

/** AccessLink needs the user registered to this client before any read.
 *  200 = registered now; 409 = already registered — both are fine. */
export async function polarRegisterUser(cfg: PolarConfig, accessToken: string, memberId: string): Promise<boolean> {
  const res = await call(`${cfg.apiBase}/v3/users`, {
    method: 'POST',
    headers: { Authorization: bearer(accessToken), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ 'member-id': memberId }),
  });
  return !!res && (res.ok || res.status === 409);
}

export type PolarRead<T> = { ok: true; value: T } | { ok: false; unauthorized: boolean };

/** The athlete's exercises of the last 30 days (Polar keeps no more here). */
export async function polarListExercises(cfg: PolarConfig, accessToken: string): Promise<PolarRead<PolarExerciseListItem[]>> {
  const res = await call(`${cfg.apiBase}/v3/exercises`, { headers: { Authorization: bearer(accessToken), Accept: 'application/json' } });
  if (!res) return { ok: false, unauthorized: false };
  if (!res.ok) return { ok: false, unauthorized: res.status === 401 || res.status === 403 };
  return { ok: true, value: parsePolarExerciseList(await res.json().catch(() => null)) };
}

/** One exercise as a FIT file. `value: null` = Polar has no FIT for it. */
export async function polarExerciseFit(cfg: PolarConfig, accessToken: string, exerciseId: string): Promise<PolarRead<Uint8Array | null>> {
  if (!POLAR_ID_RE.test(exerciseId)) return { ok: false, unauthorized: false };
  const res = await call(`${cfg.apiBase}/v3/exercises/${exerciseId}/fit`, { headers: { Authorization: bearer(accessToken), Accept: '*/*' } });
  if (!res) return { ok: false, unauthorized: false };
  if (res.status === 204 || res.status === 404) return { ok: true, value: null };
  if (!res.ok) return { ok: false, unauthorized: res.status === 401 || res.status === 403 };
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A FIT a watch records is well under this; anything larger is not one.
  if (bytes.length === 0) return { ok: true, value: null };
  if (bytes.length > 8 * 1024 * 1024) return { ok: false, unauthorized: false };
  return { ok: true, value: bytes };
}

/** One exercise's summary (the fallback when there is no FIT). */
export async function polarExerciseSummary(cfg: PolarConfig, accessToken: string, exerciseId: string): Promise<PolarRead<unknown>> {
  if (!POLAR_ID_RE.test(exerciseId)) return { ok: false, unauthorized: false };
  const res = await call(`${cfg.apiBase}/v3/exercises/${exerciseId}`, { headers: { Authorization: bearer(accessToken), Accept: 'application/json' } });
  if (!res) return { ok: false, unauthorized: false };
  if (!res.ok) return { ok: false, unauthorized: res.status === 401 || res.status === 403 };
  return { ok: true, value: await res.json().catch(() => null) };
}

/** Withdraw at Polar: de-registers the user from this client and revokes
 *  the token (the agreement's 3.3). Best effort — our row goes either way. */
export async function polarDeleteUser(cfg: PolarConfig, accessToken: string, userId: string): Promise<boolean> {
  if (!POLAR_ID_RE.test(userId)) return false;
  const res = await call(`${cfg.apiBase}/v3/users/${userId}`, { method: 'DELETE', headers: { Authorization: bearer(accessToken) } });
  return !!res && (res.status === 204 || res.ok || res.status === 404);
}

export type PolarWebhookCreated =
  | { ok: true; id: string; signatureSecretKey: string }
  | { ok: false; status: number; error: string };

/** Create THE webhook (one per client): EXERCISE events to `url`. The
 *  signature key in the answer is shown by Polar exactly once. */
export async function polarCreateWebhook(cfg: PolarConfig, url: string): Promise<PolarWebhookCreated> {
  const res = await call(`${cfg.apiBase}/v3/webhooks`, {
    method: 'POST',
    headers: { Authorization: basic(cfg), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ events: ['EXERCISE'], url }),
  });
  if (!res) return { ok: false, status: 502, error: 'Polar did not answer. Try again.' };
  if (res.status === 409) return { ok: false, status: 409, error: 'This Polar client already has a webhook. Delete it in Polar’s admin first, or keep using its signature key.' };
  if (!res.ok) return { ok: false, status: 502, error: `Polar refused the webhook (HTTP ${res.status}).` };
  const body = (await res.json().catch(() => null)) as { data?: { id?: unknown; signature_secret_key?: unknown } } | null;
  const id = typeof body?.data?.id === 'string' || typeof body?.data?.id === 'number' ? String(body.data.id) : '';
  const key = typeof body?.data?.signature_secret_key === 'string' ? body.data.signature_secret_key : '';
  if (!key) return { ok: false, status: 502, error: 'Polar created the webhook but returned no signature key.' };
  return { ok: true, id, signatureSecretKey: key };
}
