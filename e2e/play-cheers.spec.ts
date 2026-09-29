import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { cleanupEvent } from './helpers/sport-events';

// Play program P7 (Sep 28 2026): live cheers. A player's public event round
// goes live; a SPECTATOR (not in the event) cheers it; the player's live page
// floats the cheer without a reload (the 10 s poll) and the count moves; a
// finished round refuses a cheer; a private round is the 404 to a stranger.
// Anonymous by design — the API never returns who cheered. Fresh users.

const SIGNED_OUT = { cookies: [], origins: [] };

interface Setup { player: QaUser; fan: QaUser; apiP: APIRequestContext; apiF: APIRequestContext; anon: APIRequestContext; eventId: string | null; gp: string }

async function liveRound(visibility: 'public' | 'private' = 'public'): Promise<Setup> {
  const player = await createQaUser({ displayName: 'Cheer Player', firstName: 'Cheer', lastName: 'Player' });
  const fan = await createQaUser({ displayName: 'Cheer Fan', firstName: 'Cheer', lastName: 'Fan' });
  const ctx = async (u: QaUser) => pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const s: Setup = { player, fan, apiP: await ctx(player), apiF: await ctx(fan), anon: await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: SIGNED_OUT, extraHTTPHeaders: bypassHeaders() }), eventId: null, gp: '' };
  const created = await s.apiP.post('/api/sport-events', {
    data: { name: `QA Cheers ${Date.now()}`, visibility, publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Cheer Links', holes: 9, starting_hole: 1 } },
  });
  expect(created.status(), await readErrorBody(created)).toBe(201);
  s.eventId = (await created.json()).event.id;
  const live = await s.apiP.post(`/api/sport-events/${s.eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
  expect(live.ok(), await readErrorBody(live)).toBe(true);
  s.gp = (await live.json()).rounds[0].group_post_id;
  expect(s.gp).toBeTruthy();
  return s;
}

async function dispose(s: Setup) {
  await cleanupEvent(s.apiP, s.eventId).catch(() => {});
  await Promise.all([s.apiP.dispose(), s.apiF.dispose(), s.anon.dispose()]);
  await deleteQaUser(s.player.id);
  await deleteQaUser(s.fan.id);
}

test.beforeAll(async () => {
  const probe = await adminClient().from('live_cheers').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 244 not applied on this target');
});

test('a spectator cheers a live round: the API, the player\'s live page floats it, a finished round refuses', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await liveRound();
  try {
    const context = `group_post:${s.gp}`;
    const feed = async (api: APIRequestContext) => api.get(`/api/live/cheers?context=${encodeURIComponent(context)}`);

    // Anyone who may watch reads the count — signed out too, on a public round.
    const first = await feed(s.anon);
    expect(first.status()).toBe(200);
    expect(first.headers()['cache-control']).toContain('no-store');
    expect(await first.json()).toMatchObject({ total: 0, live: true });

    // Only signed-in watchers cheer; a key from the six; a target must be a player.
    expect((await s.anon.post('/api/live/cheers', { data: { context, cheer: 'fire' } })).status()).toBe(401);
    expect((await s.apiF.post('/api/live/cheers', { data: { context, cheer: 'boo' } })).status()).toBe(400);
    expect((await s.apiF.post('/api/live/cheers', { data: { context, cheer: 'fire', target: s.fan.id } })).status()).toBe(400);
    const cheered = await s.apiF.post('/api/live/cheers', { data: { context, cheer: 'fire', target: s.player.id } });
    expect(cheered.status(), await readErrorBody(cheered)).toBe(201);
    expect(await cheered.json()).toMatchObject({ total: 1, totals: { fire: 1 } });

    // Anonymous: the feed never says who cheered.
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await (await s.apiP.get(`/api/live/cheers?context=${encodeURIComponent(context)}&since=${since}`)).json();
    expect(recent.recent).toHaveLength(1);
    expect(JSON.stringify(recent)).not.toContain(s.fan.id);

    // The player's live page: the bar, then a fresh cheer floats in without a reload.
    const ctx = await browser.newContext({ storageState: await mintStorageState(s.player), extraHTTPHeaders: bypassHeaders() });
    const page = await ctx.newPage();
    await page.goto(`/live/${s.gp}`);
    const bar = page.locator(`[data-cheers="${context}"]`);
    await expect(bar.locator('[data-cheers-total]')).toHaveText('1 cheer', { timeout: 20_000 });
    await page.waitForTimeout(1_500); // let the baseline read land before the next cheer
    // The player's score-entry sheet opens over the page — the cheer must float ABOVE it.
    expect((await s.apiF.post('/api/live/cheers', { data: { context, cheer: 'clap' } })).status()).toBe(201);
    const float = page.locator('[data-cheer-float]').first();
    await expect(float).toBeAttached({ timeout: 20_000 });
    await expect(bar.locator('[data-cheers-total]')).toHaveText('2 cheers');
    // The player cheers too (their own tap floats at once and counts) — after closing the sheet.
    const sheetClose = page.getByRole('button', { name: 'Close' });
    if (await sheetClose.isVisible()) await sheetClose.click();
    const posted = page.waitForResponse(r => r.url().includes('/api/live/cheers') && r.request().method() === 'POST');
    await bar.locator('[data-cheer="hands"]').click();
    await expect(bar.locator('[data-cheers-total]')).toHaveText('3 cheers'); // optimistic, at once
    expect((await posted).status(), 'the tap reached the server').toBe(201);
    await ctx.close();

    // A finished round refuses a cheer, and still shows its count.
    const done = await s.apiP.post(`/api/sport-events/${s.eventId}/transition`, { data: { to: 'completed', override: true } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);
    expect((await s.apiF.post('/api/live/cheers', { data: { context, cheer: 'wow' } })).status()).toBe(409);
    expect(await (await feed(s.anon)).json()).toMatchObject({ total: 3, live: false });
  } finally {
    await dispose(s);
  }
});

test('a private round is the 404 to a stranger — reading and cheering', async () => {
  test.setTimeout(120_000);
  const s = await liveRound('private');
  try {
    const context = `group_post:${s.gp}`;
    expect((await s.apiF.get(`/api/live/cheers?context=${encodeURIComponent(context)}`)).status()).toBe(404);
    expect((await s.apiF.post('/api/live/cheers', { data: { context, cheer: 'fire' } })).status()).toBe(404);
    expect((await s.anon.get(`/api/live/cheers?context=${encodeURIComponent(context)}`)).status()).toBe(404);
    expect((await s.apiP.get(`/api/live/cheers?context=${encodeURIComponent(context)}`)).status()).toBe(200);
    expect((await s.apiF.get('/api/live/cheers?context=contest:00000000-0000-4000-8000-000000000000')).status()).toBe(404);
  } finally {
    await dispose(s);
  }
});

test('the cheer bar at phone width @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await liveRound();
  try {
    const ctx = await browser.newContext({ storageState: await mintStorageState(s.fan), extraHTTPHeaders: bypassHeaders(), viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/live/${s.gp}`);
    const bar = page.locator(`[data-cheers="group_post:${s.gp}"]`);
    await expect(bar.locator('[data-cheer="fire"]')).toBeVisible({ timeout: 20_000 });
    await bar.locator('[data-cheer="fire"]').scrollIntoViewIfNeeded();
    const posted = page.waitForResponse(r => r.url().includes('/api/live/cheers') && r.request().method() === 'POST');
    await bar.locator('[data-cheer="fire"]').click();
    await expect(bar.locator('[data-cheers-total]')).toHaveText('1 cheer');
    expect((await posted).status()).toBe(201);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);
    await ctx.close();
  } finally {
    await dispose(s);
  }
});
