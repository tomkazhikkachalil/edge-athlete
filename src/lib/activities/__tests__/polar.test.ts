import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'crypto';
import { CONNECT_ERRORS, CONNECTION_PROVIDERS, PROVIDER_DEFS, projectConnections, sourceCredit, sourceName } from '../connections';
import { signOAuthState, verifyOAuthState } from '../oauth-state-server';
import {
  parseIsoDuration,
  parsePolarExerciseList,
  parsePolarWebhook,
  polarSportType,
  polarStart,
  polarSummaryToActivity,
  verifyPolarSignature,
} from '../providers/polar';
import { polarAuthorizeUrl, polarConfig } from '../providers/polar-server';
import { summarize } from '../normalize';

// Polar's own example (AccessLink v3, GET /v3/exercises).
const EXAMPLE = {
  id: '2AC312F',
  upload_time: '2008-10-13T10:40:02.000Z',
  polar_user: 'https://www.polaraccesslink/v3/users/1',
  device: 'Polar M400',
  start_time: '2008-10-13T10:40:02',
  start_time_utc_offset: 180,
  duration: 'PT2H44M',
  calories: 530,
  distance: 1600,
  heart_rate: { average: 129, maximum: 147 },
  sport: 'OTHER',
  has_route: true,
  detailed_sport_info: 'WATERSPORTS_WATERSKI',
};

describe('the webhook signature', () => {
  const secret = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
  const body = JSON.stringify({ event: 'EXERCISE', user_id: 475, entity_id: 'aQlC83', timestamp: '2018-05-15T14:22:24Z', url: 'https://www.polaraccesslink.com/v3/exercises/aQlC83' });
  const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('accepts the HMAC-SHA256 of the raw body, hex, in either case', () => {
    expect(verifyPolarSignature(body, sig, secret)).toBe(true);
    expect(verifyPolarSignature(body, sig.toUpperCase(), secret)).toBe(true);
  });

  it('refuses a changed body, a wrong key, a malformed or missing header, and no key', () => {
    expect(verifyPolarSignature(body + ' ', sig, secret)).toBe(false);
    expect(verifyPolarSignature(body, sig, 'another-key')).toBe(false);
    expect(verifyPolarSignature(body, sig.slice(0, 60), secret)).toBe(false);
    expect(verifyPolarSignature(body, 'zz' + sig.slice(2), secret)).toBe(false);
    expect(verifyPolarSignature(body, null, secret)).toBe(false);
    expect(verifyPolarSignature(body, sig, null)).toBe(false);
    expect(verifyPolarSignature(body, sig, '')).toBe(false);
  });
});

describe('the webhook payload', () => {
  it('reads an exercise event and never its url', () => {
    const hook = parsePolarWebhook({ event: 'EXERCISE', user_id: 475, entity_id: 'aQlC83', url: 'https://evil.example/steal' });
    expect(hook).toEqual({ event: 'EXERCISE', userId: '475', exerciseId: 'aQlC83' });
    expect(JSON.stringify(hook)).not.toContain('evil');
  });

  it('knows the ping and ignores events it does not act on', () => {
    expect(parsePolarWebhook({ event: 'PING', timestamp: '2026-10-01T00:00:00Z' })).toEqual({ event: 'PING' });
    expect(parsePolarWebhook({ event: 'SLEEP', user_id: 475, entity_id: 'x' })).toEqual({ event: 'OTHER' });
  });

  it('refuses ids that are not ids (they would become part of a URL)', () => {
    expect(parsePolarWebhook({ event: 'EXERCISE', user_id: 475, entity_id: '../users/1' })).toBeNull();
    expect(parsePolarWebhook({ event: 'EXERCISE', user_id: '4 7 5', entity_id: 'aQlC83' })).toBeNull();
    expect(parsePolarWebhook({ event: 'EXERCISE', entity_id: 'aQlC83' })).toBeNull();
    expect(parsePolarWebhook(null)).toBeNull();
    expect(parsePolarWebhook([])).toBeNull();
    expect(parsePolarWebhook({})).toBeNull();
  });
});

describe('the exercise summary', () => {
  it('places the start from the local time and its offset', () => {
    expect(polarStart(EXAMPLE)).toEqual({ t: Date.UTC(2008, 9, 13, 7, 40, 2), offsetMin: 180 });
    expect(polarStart({ ...EXAMPLE, start_time_utc_offset: undefined })).toBeNull(); // never a guessed zone
    expect(polarStart({ ...EXAMPLE, start_time: '2008-10-13' })).toBeNull();
  });

  it('reads ISO durations', () => {
    expect(parseIsoDuration('PT2H44M')).toBe(9840);
    expect(parseIsoDuration('PT45M30.5S')).toBe(2730.5);
    expect(parseIsoDuration('PT90S')).toBe(90);
    expect(parseIsoDuration('PT')).toBeNull();
    expect(parseIsoDuration('2 hours')).toBeNull();
    expect(parseIsoDuration(9840)).toBeNull();
  });

  it('maps Polar sport words through an explicit list', () => {
    expect(polarSportType('RUNNING')).toBe('run');
    expect(polarSportType('OTHER', 'TRAIL_RUNNING')).toBe('trail_run');
    expect(polarSportType('CYCLING', 'MOUNTAIN_BIKING')).toBe('mountain_bike');
    expect(polarSportType('CYCLING', 'ROAD_BIKING')).toBe('ride');
    expect(polarSportType('SWIMMING', 'POOL_SWIMMING')).toBe('swim');
    expect(polarSportType('OTHER', 'CROSS-COUNTRY_SKIING')).toBe('ski');
    expect(polarSportType('OTHER', 'WATERSPORTS_WATERSKI')).toBe('other'); // "waterski" is not skiing
    expect(polarSportType('OTHER', 'STRENGTH_TRAINING')).toBe('other');
    expect(polarSportType(undefined)).toBe('other');
  });

  it('becomes a bare activity the writer can summarise (no FIT)', () => {
    const activity = polarSummaryToActivity(EXAMPLE)!;
    expect(activity.format).toBeNull();
    expect(activity.type).toBe('other');
    expect(activity.tzOffsetMin).toBe(180);
    expect(activity.device).toEqual({ elapsedS: 9840, distanceM: 1600, calories: 530 });
    const summary = summarize(activity);
    expect(summary.startedAt).toBe(Date.UTC(2008, 9, 13, 7, 40, 2));
    expect(summary.elapsedS).toBe(9840);
    expect(summary.distanceM).toBe(1600);
    expect(summary.avgHr).toBe(129);
    expect(summary.hasRoute).toBe(false);
  });

  it('refuses a summary that does not say when it happened', () => {
    expect(polarSummaryToActivity({ ...EXAMPLE, duration: 'PT0S' })).toBeNull();
    expect(polarSummaryToActivity({ ...EXAMPLE, start_time_utc_offset: null })).toBeNull();
    expect(polarSummaryToActivity('nope')).toBeNull();
  });

  it('lists exercises, dropping ids that are not ids', () => {
    expect(parsePolarExerciseList([EXAMPLE, { id: '../x' }, { id: 12345 }, null])).toEqual([
      { id: '2AC312F', startedAt: Date.UTC(2008, 9, 13, 7, 40, 2) },
      { id: '12345', startedAt: null },
    ]);
    expect(parsePolarExerciseList({ exercises: [] })).toEqual([]);
  });
});

describe('the Polar client configuration', () => {
  it('is off until both credentials are set', () => {
    expect(polarConfig({})).toBeNull();
    expect(polarConfig({ POLAR_CLIENT_ID: 'id' })).toBeNull();
    const cfg = polarConfig({ POLAR_CLIENT_ID: 'id', POLAR_CLIENT_SECRET: 'secret' })!;
    expect(cfg).toMatchObject({ authBase: 'https://flow.polar.com', tokenBase: 'https://polarremote.com', apiBase: 'https://www.polaraccesslink.com', webhookSecret: null });
  });

  it('the test stand-in is honoured outside production and IGNORED in production', () => {
    const env = { POLAR_CLIENT_ID: 'id', POLAR_CLIENT_SECRET: 'secret', POLAR_MOCK_BASE: 'http://127.0.0.1:4010/' };
    expect(polarConfig(env)!.apiBase).toBe('http://127.0.0.1:4010');
    expect(polarConfig({ ...env, VERCEL_ENV: 'preview' })!.authBase).toBe('http://127.0.0.1:4010');
    const prod = polarConfig({ ...env, VERCEL_ENV: 'production' })!;
    expect(prod.authBase).toBe('https://flow.polar.com');
    expect(prod.tokenBase).toBe('https://polarremote.com');
    expect(prod.apiBase).toBe('https://www.polaraccesslink.com');
  });

  it('builds the authorize URL Polar documents', () => {
    const cfg = polarConfig({ POLAR_CLIENT_ID: 'my client', POLAR_CLIENT_SECRET: 's' })!;
    const u = new URL(polarAuthorizeUrl(cfg, { state: 'abc.def', redirectUri: 'https://edgeathlete.ca/api/connections/polar/callback' }));
    expect(u.origin + u.pathname).toBe('https://flow.polar.com/oauth2/authorization');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'my client',
      redirect_uri: 'https://edgeathlete.ca/api/connections/polar/callback',
      scope: 'accesslink.read_all',
      state: 'abc.def',
    });
  });
});

describe('the OAuth state', () => {
  const saved = process.env.CONNECTIONS_ENC_KEY;
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  beforeEach(() => {
    process.env.CONNECTIONS_ENC_KEY = randomBytes(32).toString('base64');
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CONNECTIONS_ENC_KEY;
    else process.env.CONNECTIONS_ENC_KEY = saved;
  });

  it('verifies only for the account and provider it was made for, for ten minutes', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    const state = signOAuthState({ userId: A, provider: 'polar', now });
    expect(verifyOAuthState(state, { userId: A, provider: 'polar', now: now + 60_000 })).toBe(true);
    expect(verifyOAuthState(state, { userId: B, provider: 'polar', now })).toBe(false); // someone else's session
    expect(verifyOAuthState(state, { userId: A, provider: 'wahoo', now })).toBe(false);
    expect(verifyOAuthState(state, { userId: A, provider: 'polar', now: now + 10 * 60_000 + 1 })).toBe(false);
  });

  it('refuses a forged, altered or foreign-key state', () => {
    const state = signOAuthState({ userId: A, provider: 'polar' });
    const [payload, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ u: B, p: 'polar', t: Date.now(), n: 'x' })).toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`, { userId: B, provider: 'polar' })).toBe(false);
    expect(verifyOAuthState(`${payload}.${sig.slice(0, -2)}xx`, { userId: A, provider: 'polar' })).toBe(false);
    expect(verifyOAuthState(`${payload}.${sig}.extra`, { userId: A, provider: 'polar' })).toBe(false);
    expect(verifyOAuthState(null, { userId: A, provider: 'polar' })).toBe(false);
    process.env.CONNECTIONS_ENC_KEY = randomBytes(32).toString('base64');
    expect(verifyOAuthState(state, { userId: A, provider: 'polar' })).toBe(false);
  });

  it('two states for the same account differ (a nonce)', () => {
    const now = Date.now();
    expect(signOAuthState({ userId: A, provider: 'polar', now })).not.toBe(signOAuthState({ userId: A, provider: 'polar', now }));
  });

  it('fails closed without the key', () => {
    const state = signOAuthState({ userId: A, provider: 'polar' });
    delete process.env.CONNECTIONS_ENC_KEY;
    expect(() => signOAuthState({ userId: A, provider: 'polar' })).toThrow(/CONNECTIONS_ENC_KEY/);
    expect(verifyOAuthState(state, { userId: A, provider: 'polar' })).toBe(false);
  });
});

describe('what the screen is told', () => {
  it('a live provider this deployment cannot connect reads "Coming soon", never an empty Connect', () => {
    const open = projectConnections([]).find(v => v.provider === 'polar')!;
    expect(PROVIDER_DEFS.polar.stage).toBe('live');
    expect(open.state).toBe('available');
    expect(open.note).toBeNull();
    const dark = projectConnections([], { unconfigured: ['polar'] }).find(v => v.provider === 'polar')!;
    expect(dark).toMatchObject({ state: 'coming', note: 'Coming soon.' });
    // …but a connection that exists is shown whatever the configuration says.
    const kept = projectConnections([{ provider: 'polar', status: 'active', connected_at: '2026-10-01T00:00:00Z', last_sync_at: null, last_error: null }], { unconfigured: ['polar'] });
    expect(kept.find(v => v.provider === 'polar')!.state).toBe('connected');
  });

  it('credits the provider where its terms ask, and nothing else', () => {
    expect(sourceCredit('polar')).toBe('Recorded with Polar');
    expect(sourceName('polar')).toBe('Polar');
    for (const s of ['file', 'upload_link', 'garmin', null, undefined]) {
      expect(sourceCredit(s)).toBeNull();
      expect(sourceName(s)).toBeNull();
    }
  });

  it('every connect error has words, and every provider is covered by the list', () => {
    for (const code of ['denied', 'expired', 'taken', 'supervised', 'limited', 'busy', 'unavailable', 'failed']) {
      expect(CONNECT_ERRORS[code]).toMatch(/\.$/);
    }
    expect(CONNECTION_PROVIDERS).toContain('polar');
  });
});
