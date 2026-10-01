import { createHmac } from 'node:crypto';
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { fitRun } from './helpers/fit';
import { POLAR_E2E_CLIENT, POLAR_MOCK_BASE, startPolarMock, type MockExercise, type PolarMock } from './helpers/polar-mock';

// Fix round part 3, PR 4 (Oct 1 2026): Polar. The athlete connects once in
// Settings; Polar then tells us (a signed webhook) when a workout is done and
// we fetch it. Everything here runs against a STAND-IN Polar
// (helpers/polar-mock.ts) that speaks the calls our client makes — the real
// hosts are never called from a test, and a real account is the one thing
// only Tom can prove.

async function ctxFor(u: QaUser | null): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: E2E_BASE_URL,
    storageState: u ? await mintStorageState(u) : { cookies: [], origins: [] },
    extraHTTPHeaders: bypassHeaders(),
  });
}

/** Polar's summary of an exercise, the way GET /v3/exercises writes it (local time + offset). */
function summaryOf(t0: number, seconds: number, over: Record<string, unknown> = {}) {
  const local = new Date(t0 - 4 * 3_600_000).toISOString().slice(0, 19);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return {
    start_time: local,
    start_time_utc_offset: -240,
    duration: `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`,
    calories: 400,
    distance: (seconds - 1) * 3,
    heart_rate: { average: 152, maximum: 170 },
    sport: 'RUNNING',
    has_route: true,
    ...over,
  };
}

const signed = (body: string) => ({
  'Content-Type': 'application/json',
  'Polar-Webhook-Signature': createHmac('sha256', POLAR_E2E_CLIENT.webhookSecret).update(body, 'utf8').digest('hex'),
});

/** start → Polar's consent (the stand-in says yes) → our callback. Returns where the athlete lands. */
async function connect(api: APIRequestContext): Promise<string> {
  const start = await api.get('/api/connections/polar/start', { maxRedirects: 0 });
  expect(start.status()).toBe(302);
  const toPolar = start.headers().location;
  expect(toPolar.startsWith(`${POLAR_MOCK_BASE}/oauth2/authorization?`)).toBe(true);
  const consent = await api.get(toPolar, { maxRedirects: 0 });
  expect(consent.status()).toBe(302);
  const callback = new URL(consent.headers().location);
  expect(callback.origin).toBe(new URL(E2E_BASE_URL).origin);
  const done = await api.get(callback.pathname + callback.search, { maxRedirects: 0 });
  expect(done.status()).toBe(302);
  return new URL(done.headers().location, E2E_BASE_URL).search;
}

let mock: PolarMock | null = null;
let ready = true;

test.beforeAll(async () => {
  const admin = adminClient();
  const probe = await admin.from('activity_connections').select('id').limit(1);
  if (probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205')) { ready = false; return; }
  // The stand-in only exists beside a LOCAL server (playwright.config.ts).
  if (!E2E_BASE_URL.includes('localhost')) { ready = false; return; }
  mock = await startPolarMock();
});

test.afterAll(async () => {
  await mock?.close();
  mock = null;
});

test('Polar: connect (signed state), first sync, the signed webhook, revoked at Polar, disconnect', async () => {
  test.skip(!ready || !mock, 'needs migration 247 and the local stand-in Polar');
  test.setTimeout(240_000);
  const polar = mock!;
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Polar Ada', firstName: 'Polar', lastName: 'Ada' });
  const b = await createQaUser({ displayName: 'Polar Bex', firstName: 'Polar', lastName: 'Bex' });
  const [apiA, apiB, anon] = await Promise.all([ctxFor(a), ctxFor(b), ctxFor(null)]);
  const view = async (api: APIRequestContext) => (await (await api.get('/api/connections')).json()).connections.find((c: { provider: string }) => c.provider === 'polar');
  const polarRows = async () => (await admin.from('activities').select('id, external_id, source, has_route, avg_hr, elapsed_s, started_at').eq('profile_id', a.id).eq('source', 'polar').order('started_at')).data ?? [];

  const NOW = Math.floor(Date.now() / 1000) * 1000;
  const P_A = 700_000 + Math.floor(Math.random() * 90_000); // A's Polar account
  const RUN_1 = NOW - 30 * 3_600_000;
  const GYM_2 = NOW - 26 * 3_600_000;
  const RUN_3 = NOW - 6 * 3_600_000;
  const ex1: MockExercise = { id: 'RUN1abc', fit: fitRun(RUN_1, 900), summary: summaryOf(RUN_1, 899) };
  // A gym session: Polar has no FIT for it — the summary is the activity.
  const ex2: MockExercise = { id: 'GYM2abc', fit: null, summary: summaryOf(GYM_2, 2700, { sport: 'OTHER', detailed_sport_info: 'STRENGTH_TRAINING', distance: undefined, has_route: false }) };
  const ex3: MockExercise = { id: 'RUN3abc', fit: fitRun(RUN_3, 1200), summary: summaryOf(RUN_3, 1199) };
  polar.setExercises(P_A, [ex1, ex2]);

  try {
    const before = await view(apiA);
    test.skip(before.state === 'coming', 'Polar is not configured on this server (no sealing key)');
    expect(before).toMatchObject({ state: 'available', label: 'Polar' });

    // Signed out: to the sign-in door, never to Polar.
    const signedOut = await anon.get('/api/connections/polar/start', { maxRedirects: 0 });
    expect(signedOut.status()).toBe(302);
    expect(signedOut.headers().location).toContain('/?signin=1');

    // ── The state is the lock ─────────────────────────────────────────────
    const start = await apiA.get('/api/connections/polar/start', { maxRedirects: 0 });
    const toPolar = new URL(start.headers().location);
    expect(Object.fromEntries(toPolar.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: POLAR_E2E_CLIENT.id,
      scope: 'accesslink.read_all',
      redirect_uri: `${new URL(E2E_BASE_URL).origin}/api/connections/polar/callback`,
    });
    const stateA = toPolar.searchParams.get('state')!;
    const land = async (api: APIRequestContext, query: string) =>
      new URL((await api.get(`/api/connections/polar/callback?${query}`, { maxRedirects: 0 })).headers().location, E2E_BASE_URL).searchParams;
    // The athlete said no at Polar.
    expect((await land(apiA, `error=access_denied&state=${encodeURIComponent(stateA)}`)).get('connect_error')).toBe('denied');
    // A code with no state, a forged state, and A's state in B's session: all refused.
    expect((await land(apiA, 'code=code-x')).get('connect_error')).toBe('expired');
    expect((await land(apiA, `code=code-x&state=${encodeURIComponent(stateA.slice(0, -3) + 'abc')}`)).get('connect_error')).toBe('expired');
    expect((await land(apiB, `code=code-x&state=${encodeURIComponent(stateA)}`)).get('connect_error')).toBe('expired');
    // A good state with a code Polar never issued: no connection.
    expect((await land(apiA, `code=never-issued&state=${encodeURIComponent(stateA)}`)).get('connect_error')).toBe('failed');
    expect((await admin.from('activity_connections').select('id', { count: 'exact', head: true }).eq('profile_id', a.id)).count).toBe(0);

    // ── Connect, and the first sync ───────────────────────────────────────
    polar.signInAs(P_A);
    expect(await connect(apiA)).toContain('connected=polar');
    const { data: row } = await admin.from('activity_connections').select('provider, status, provider_user_id, secret_ciphertext, token_hash, last_sync_at').eq('profile_id', a.id).single();
    expect(row).toMatchObject({ provider: 'polar', status: 'active', provider_user_id: String(P_A), token_hash: null });
    expect(row!.secret_ciphertext).toMatch(/^v1\./);
    expect(row!.secret_ciphertext).not.toContain('polar-token');
    expect(row!.last_sync_at).not.toBeNull();
    expect(polar.calls).toContain('POST /v3/users');

    // The connection, as its owner sees it: connected, and never the token.
    const mineText = await (await apiA.get('/api/connections')).text();
    expect(mineText).not.toMatch(/polar-token|secret_ciphertext|v1\./);
    expect(JSON.parse(mineText).connections.find((c: { provider: string }) => c.provider === 'polar').state).toBe('connected');

    // Both exercises are in: the run from its FIT, the gym session from its summary.
    let rows = await polarRows();
    expect(rows.map(r => r.external_id)).toEqual(['RUN1abc', 'GYM2abc']);
    expect(rows[0]).toMatchObject({ has_route: true, elapsed_s: 899 });
    expect(Date.parse(rows[0].started_at)).toBe(RUN_1);
    expect(rows[1]).toMatchObject({ has_route: false, elapsed_s: 2700, avg_hr: 152 });
    expect(Date.parse(rows[1].started_at)).toBe(GYM_2);

    // The credit Polar's terms ask for travels with the activity.
    const detail = await (await apiA.get(`/api/activities/${rows[0].id}`)).json();
    expect(JSON.stringify(detail)).toContain('Recorded with Polar');

    // ── The webhook ───────────────────────────────────────────────────────
    polar.setExercises(P_A, [ex1, ex2, ex3]);
    const event = JSON.stringify({ event: 'EXERCISE', user_id: P_A, entity_id: 'RUN3abc', timestamp: new Date().toISOString(), url: 'https://evil.example/v3/exercises/RUN3abc' });
    // The creation ping carries no signature and does nothing.
    expect((await anon.post('/api/webhooks/polar', { headers: { 'Content-Type': 'application/json', 'Polar-Webhook-Event': 'PING' }, data: JSON.stringify({ event: 'PING', timestamp: new Date().toISOString() }) })).status()).toBe(200);
    // Unsigned, wrongly signed, and signed-for-another-body events are refused.
    expect((await anon.post('/api/webhooks/polar', { headers: { 'Content-Type': 'application/json' }, data: event })).status()).toBe(401);
    expect((await anon.post('/api/webhooks/polar', { headers: { ...signed(event), 'Polar-Webhook-Signature': 'a'.repeat(64) }, data: event })).status()).toBe(401);
    expect((await anon.post('/api/webhooks/polar', { headers: signed(event + ' '), data: event })).status()).toBe(401);
    expect((await anon.post('/api/webhooks/polar', { headers: signed('{}'), data: 'not json' })).status()).toBe(400);
    expect((await polarRows()).length).toBe(2);

    // Signed: the exercise is fetched from OUR Polar base by its id and imported.
    const delivered = await anon.post('/api/webhooks/polar', { headers: signed(event), data: event });
    expect(delivered.status(), await readErrorBody(delivered)).toBe(200);
    expect(await delivered.json()).toMatchObject({ ok: true, result: 'imported' });
    rows = await polarRows();
    expect(rows.map(r => r.external_id)).toEqual(['RUN1abc', 'GYM2abc', 'RUN3abc']);
    // Polar's retry of the same event: still one.
    expect(await (await anon.post('/api/webhooks/polar', { headers: signed(event), data: event })).json()).toMatchObject({ result: 'duplicate' });
    expect((await polarRows()).length).toBe(3);
    // A connection outlives the moment it was made: an account that has since
    // become supervised, or that moderation holds, receives nothing.
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', a.id);
    try {
      expect(await (await anon.post('/api/webhooks/polar', { headers: signed(event), data: event })).json()).toMatchObject({ result: 'refused' });
    } finally {
      await admin.from('profiles').update({ supervision_state: 'self' }).eq('id', a.id);
    }
    await admin.from('profiles').update({ moderation_state: 'limited' }).eq('id', a.id);
    try {
      expect(await (await anon.post('/api/webhooks/polar', { headers: signed(event), data: event })).json()).toMatchObject({ result: 'refused' });
    } finally {
      await admin.from('profiles').update({ moderation_state: 'active' }).eq('id', a.id);
    }
    expect(await (await anon.post('/api/webhooks/polar', { headers: signed(event), data: event })).json()).toMatchObject({ result: 'duplicate' });
    // A signed event for an athlete we do not know: acknowledged, nothing done.
    const stranger = JSON.stringify({ event: 'EXERCISE', user_id: 1, entity_id: 'RUN3abc' });
    expect(await (await anon.post('/api/webhooks/polar', { headers: signed(stranger), data: stranger })).json()).toEqual({ ok: true });
    // An event type we do not act on.
    const sleep = JSON.stringify({ event: 'SLEEP', user_id: P_A, entity_id: 'x' });
    expect((await anon.post('/api/webhooks/polar', { headers: signed(sleep), data: sleep })).status()).toBe(200);

    // ── One Polar account feeds one athlete ───────────────────────────────
    polar.signInAs(P_A);
    expect(await connect(apiB)).toContain('connect_error=taken');
    expect((await admin.from('activity_connections').select('id', { count: 'exact', head: true }).eq('profile_id', b.id)).count).toBe(0);

    // ── Consent withdrawn AT Polar: the next call is a 401 ────────────────
    polar.revoke(P_A, true);
    polar.setExercises(P_A, [ex1, ex2, ex3, { id: 'RUN4abc', fit: fitRun(NOW - 2 * 3_600_000, 600), summary: summaryOf(NOW - 2 * 3_600_000, 599) }]);
    const late = JSON.stringify({ event: 'EXERCISE', user_id: P_A, entity_id: 'RUN4abc' });
    expect(await (await anon.post('/api/webhooks/polar', { headers: signed(late), data: late })).json()).toMatchObject({ result: 'unauthorized' });
    const { data: gone } = await admin.from('activity_connections').select('status, secret_ciphertext').eq('profile_id', a.id).single();
    expect(gone).toEqual({ status: 'revoked', secret_ciphertext: null });
    const attention = await view(apiA);
    expect(attention.state).toBe('needs_attention');
    expect(attention.problem).toMatch(/Polar stopped sharing/);
    expect((await polarRows()).length).toBe(3);

    // Connecting again heals it, and the sync picks up what was missed.
    polar.revoke(P_A, false);
    polar.signInAs(P_A);
    expect(await connect(apiA)).toContain('connected=polar');
    expect((await view(apiA)).state).toBe('connected');
    expect((await polarRows()).map(r => r.external_id)).toEqual(['RUN1abc', 'GYM2abc', 'RUN3abc', 'RUN4abc']);

    // ── The refusals at the door ──────────────────────────────────────────
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', b.id);
    try {
      const refused = await apiB.get('/api/connections/polar/start', { maxRedirects: 0 });
      expect(refused.headers().location).toContain('connect_error=supervised');
    } finally {
      await admin.from('profiles').update({ supervision_state: 'self' }).eq('id', b.id);
    }
    await admin.from('profiles').update({ moderation_state: 'limited' }).eq('id', b.id);
    try {
      const refused = await apiB.get('/api/connections/polar/start', { maxRedirects: 0 });
      expect(refused.headers().location).toContain('connect_error=limited');
    } finally {
      await admin.from('profiles').update({ moderation_state: 'active' }).eq('id', b.id);
    }

    // ── Disconnect: withdrawn at Polar, the row gone, the activities kept ──
    const callsBefore = polar.calls.length;
    const off = await apiA.delete('/api/connections/polar');
    expect(off.status(), await readErrorBody(off)).toBe(200);
    expect((await off.json()).removed).toBe(true);
    expect(polar.calls.slice(callsBefore)).toContain(`DELETE /v3/users/${P_A}`);
    expect((await admin.from('activity_connections').select('id', { count: 'exact', head: true }).eq('profile_id', a.id)).count).toBe(0);
    expect((await polarRows()).length).toBe(4);
    // A webhook for an athlete who disconnected does nothing.
    polar.revoke(P_A, false);
    expect(await (await anon.post('/api/webhooks/polar', { headers: signed(event), data: event })).json()).toEqual({ ok: true });
  } finally {
    await Promise.all([apiA.dispose(), apiB.dispose(), anon.dispose()]);
    await deleteQaUser(a.id);
    await deleteQaUser(b.id);
  }
});

test('Settings → Polar: the consent line, Connect, back with the workouts in Vitals @mobile', async ({ page }) => {
  test.skip(!ready || !mock, 'needs migration 247 and the local stand-in Polar');
  test.setTimeout(120_000);
  const polar = mock!;
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  const P = 800_000 + Math.floor(Math.random() * 90_000);
  const START = Math.floor(Date.now() / 1000) * 1000 - 3 * 3_600_000;
  const id = `UI${Math.random().toString(36).slice(2, 8)}`;
  polar.setExercises(P, [{ id, fit: fitRun(START, 900), summary: summaryOf(START, 899) }]);
  polar.signInAs(P);
  await admin.from('activity_connections').delete().eq('profile_id', alpha.id);

  await page.goto('/settings?tab=connections');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible({ timeout: 20_000 });
  if ((await page.getByRole('button', { name: 'Connected apps' }).count()) === 0) {
    test.skip(true, 'connected-apps flag off in this build');
    return;
  }

  try {
    const card = page.locator('[data-connection="polar"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    test.skip((await card.getAttribute('data-connection-state')) === 'coming', 'Polar is not configured on this server');
    await expect(card).toHaveAttribute('data-connection-state', 'available');
    // What they agree to is said BEFORE they leave for Polar.
    await expect(card).toContainText('where the people who can see your profile can see them');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Connect: out to Polar (the stand-in says yes) and back.
    await card.locator('[data-provider-connect-link]').click();
    await page.waitForURL(/\/settings\?tab=connections&connected=polar/, { timeout: 30_000 });
    await expect(page.locator('[data-connect-result="connected"]')).toContainText('Polar is connected', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-connection-state', 'connected', { timeout: 20_000 });
    await expect(card).toContainText('Last workout received');
    await expect(card.locator('[data-connection-disconnect]')).toBeVisible();

    // The workout is already in Vitals, credited to Polar.
    await page.goto('/athlete?tab=vitals');
    const session = page.locator('[data-vitals-recent-sessions] [data-session-kind="activity"]').first();
    await expect(session).toBeVisible({ timeout: 20_000 });
    await expect(session).toContainText('Polar');
    const { data: row } = await admin.from('activities').select('id, post_id').eq('profile_id', alpha.id).eq('source', 'polar').eq('external_id', id).single();
    expect(row!.post_id).toBeNull(); // in Vitals; the athlete shares
    await page.goto(`/activities/${row!.id}`);
    await expect(page.locator('[data-activity-credit]')).toHaveText(/Recorded with Polar/, { timeout: 20_000 });

    // A failed trip says why, in words.
    await page.goto('/settings?tab=connections&connect_error=taken');
    await expect(page.locator('[data-connect-result="error"]')).toContainText('already connected to another Edge Athlete account', { timeout: 20_000 });
  } finally {
    await admin.from('activity_connections').delete().eq('profile_id', alpha.id);
    const { data: rows } = await admin.from('activities').select('id, stream_path').eq('profile_id', alpha.id).eq('source', 'polar');
    for (const r of rows ?? []) {
      if (r.stream_path) await admin.storage.from('uploads').remove([r.stream_path]);
      await admin.from('activities').delete().eq('id', r.id);
    }
  }
});

test('the owner\'s Polar setup: not for athletes; the panel shows the URLs and creates the webhook once', async ({ browser }) => {
  test.skip(!ready || !mock, 'needs migration 247 and the local stand-in Polar');
  test.setTimeout(120_000);
  const polar = mock!;

  // An athlete — and a signed-out caller — get nothing from the setup route.
  const qa = await apiAs('state.json');
  const anon = await ctxFor(null);
  try {
    expect([401, 403]).toContain((await qa.get('/api/admin/connections/polar-webhook')).status());
    expect([401, 403]).toContain((await qa.post('/api/admin/connections/polar-webhook')).status());
    expect((await anon.get('/api/admin/connections/polar-webhook')).status()).toBe(401);
    expect(polar.webhookUrl()).toBeNull();
  } finally {
    await Promise.all([qa.dispose(), anon.dispose()]);
  }

  const adminEmail = adminEmailForE2E();
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — the panel half needs an address on the target build\'s ADMIN_EMAILS');
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  try {
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    const panel = page.locator('[data-admin-connected-apps]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const origin = new URL(E2E_BASE_URL).origin;
    await expect(panel.locator('[data-polar-callback-url]')).toHaveText(`${origin}/api/connections/polar/callback`, { timeout: 20_000 });

    await panel.locator('[data-polar-create-webhook]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create it' }).click();
    // The key is shown once, for the owner to put in Vercel; Polar now calls OUR webhook URL.
    await expect(panel.locator('[data-polar-webhook-key]')).toContainText(POLAR_E2E_CLIENT.webhookSecret, { timeout: 20_000 });
    expect(polar.webhookUrl()).toBe(`${origin}/api/webhooks/polar`);

    // Polar allows one webhook per client: a second try says so.
    await panel.locator('[data-polar-create-webhook]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create it' }).click();
    await expect(panel.getByRole('alert')).toContainText('already has a webhook', { timeout: 20_000 });
  } finally {
    await ctx.close();
    await deleteQaUser(adminUser.id);
  }
});
