import { createHash, randomBytes } from 'node:crypto';
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { parseGpx } from '../src/lib/activities/parse-gpx';
import { toWire } from '../src/lib/activities/wire';
import { gpxOf, line } from '../src/lib/activities/__tests__/fixtures';
import { CONNECTION_PROVIDERS } from '../src/lib/activities/connections';

// Fix round part 3, PR 2 (Oct 1 2026, mig 247): connected apps — the table
// behind them, the reader that never shows a secret, Settings → Connected
// apps, and the rule that one activity stays ONE however many sources
// deliver it. Tom: "You're supposed to connect permanently … you connect to
// the applications in settings."

async function ctxFor(u: QaUser | null): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: E2E_BASE_URL,
    storageState: u ? await mintStorageState(u) : { cookies: [], origins: [] },
    extraHTTPHeaders: bypassHeaders(),
  });
}

/** An upload-link connection, written the way the mint route will (PR 3):
 *  only the sha256 of the token is stored. */
async function seedUploadLink(profileId: string): Promise<{ hash: string }> {
  const hash = createHash('sha256').update(randomBytes(32).toString('base64url')).digest('hex');
  const { error } = await adminClient()
    .from('activity_connections')
    .upsert({ profile_id: profileId, provider: 'upload_link', token_hash: hash }, { onConflict: 'profile_id,provider' });
  expect(error, error?.message).toBeNull();
  return { hash };
}

function gpxWire(t0: number, opts: { hr?: number; n?: number } = {}) {
  const parsed = parseGpx(gpxOf(line(opts.n ?? 600, { t0, stepM: 3, hr: opts.hr })));
  return toWire({ ...parsed, format: 'gpx' }, 'America/Toronto');
}

let tableThere = true;

test.beforeAll(async () => {
  const probe = await adminClient().from('activity_connections').select('id').limit(1);
  tableThere = !(probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'));
});

test('connections API: own rows only, never a secret, disconnect; one activity from two deliveries', async () => {
  test.skip(!tableThere, 'migration 247 not applied on this target');
  test.setTimeout(150_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Watch Ada', firstName: 'Watch', lastName: 'Ada' });
  const b = await createQaUser({ displayName: 'Other Bex', firstName: 'Other', lastName: 'Bex' });
  const [apiA, apiB, anon] = await Promise.all([ctxFor(a), ctxFor(b), ctxFor(null)]);
  try {
    // Signed out: nothing.
    expect((await anon.get('/api/connections')).status()).toBe(401);

    // Nothing connected: one entry per provider, in list order, none linked.
    const empty = await apiA.get('/api/connections');
    expect(empty.status(), await readErrorBody(empty)).toBe(200);
    expect(empty.headers()['cache-control']).toContain('no-store');
    const emptyBody = await empty.json();
    expect(emptyBody.supported).toBe(true);
    expect(emptyBody.supervised).toBe(false);
    expect(emptyBody.connections.map((c: { provider: string }) => c.provider)).toEqual([...CONNECTION_PROVIDERS]);
    expect(emptyBody.connections.every((c: { state: string }) => c.state === 'available' || c.state === 'coming')).toBe(true);

    // A connection exists: its owner sees it connected — and never its hash.
    const { hash } = await seedUploadLink(a.id);
    const mine = await apiA.get('/api/connections');
    const mineText = await mine.text();
    expect(mineText).not.toContain(hash);
    expect(mineText).not.toMatch(/token_hash|secret_ciphertext|provider_user_id/);
    const link = JSON.parse(mineText).connections.find((c: { provider: string }) => c.provider === 'upload_link');
    expect(link).toMatchObject({ state: 'connected', label: 'Apple Watch', lastSyncAt: null, problem: null });
    expect(typeof link.connectedAt).toBe('string');

    // Another account sees none of it, and cannot remove it.
    const theirs = await (await apiB.get('/api/connections')).json();
    expect(theirs.connections.find((c: { provider: string }) => c.provider === 'upload_link').state).not.toBe('connected');
    const foreign = await apiB.delete('/api/connections/upload_link');
    expect(foreign.status(), await readErrorBody(foreign)).toBe(200);
    expect((await foreign.json()).removed).toBe(false);
    const { count: still } = await admin.from('activity_connections').select('id', { count: 'exact', head: true }).eq('profile_id', a.id);
    expect(still).toBe(1);

    // A status the provider set reads as "needs attention", in our words.
    await admin.from('activity_connections').update({ status: 'error', last_error: 'The last delivery could not be read.' }).eq('profile_id', a.id);
    const errored = (await (await apiA.get('/api/connections')).json()).connections.find((c: { provider: string }) => c.provider === 'upload_link');
    expect(errored).toMatchObject({ state: 'needs_attention', problem: 'The last delivery could not be read.' });

    // A supervised account is told so (it cannot connect).
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', b.id);
    try {
      expect((await (await apiB.get('/api/connections')).json()).supervised).toBe(true);
    } finally {
      await admin.from('profiles').update({ supervision_state: 'self' }).eq('id', b.id);
    }

    // Not a provider: refused by name. Strava is not one (left out by decision).
    expect((await apiA.delete('/api/connections/strava')).status()).toBe(400);
    expect((await anon.delete('/api/connections/upload_link')).status()).toBe(401);

    // Disconnect: the row goes; a second tap is the same success.
    const off = await apiA.delete('/api/connections/upload_link');
    expect(off.status(), await readErrorBody(off)).toBe(200);
    expect((await off.json()).removed).toBe(true);
    const { count: gone } = await admin.from('activity_connections').select('id', { count: 'exact', head: true }).eq('profile_id', a.id);
    expect(gone).toBe(0);
    expect((await (await apiA.delete('/api/connections/upload_link')).json()).removed).toBe(false);

    // ── One activity, however many times it arrives ───────────────────────
    const T0 = Date.now() - 3 * 3_600_000;
    const first = await apiA.post('/api/activities', { data: { activity: gpxWire(T0) } });
    expect(first.status(), await readErrorBody(first)).toBe(201);
    const id = (await first.json()).id as string;

    // The same run, its clock four seconds off (another export of it): the
    // SAME activity. It is no richer, so what is stored stands.
    const again = await apiA.post('/api/activities', { data: { activity: gpxWire(T0 + 4000) } });
    expect(again.status(), await readErrorBody(again)).toBe(200);
    expect(await again.json()).toMatchObject({ id, duplicate: true });
    const { data: kept } = await admin.from('activities').select('started_at, avg_hr, source, external_id').eq('id', id).single();
    expect(Date.parse(kept!.started_at)).toBe(T0); // the first delivery's start, not the second's
    expect(kept!.avg_hr).toBeNull();
    expect(kept!.source).toBe('file');

    // The same run again WITH heart rate: richer — the row is refreshed, and
    // keeps the identity of the first delivery.
    const richer = await apiA.post('/api/activities', { data: { activity: gpxWire(T0 + 4000, { hr: 150 }) } });
    expect(richer.status(), await readErrorBody(richer)).toBe(200);
    expect(await richer.json()).toMatchObject({ id, duplicate: true });
    const { data: refreshed } = await admin.from('activities').select('avg_hr, external_id').eq('id', id).single();
    expect(refreshed!.avg_hr).toBeGreaterThan(140);
    expect(refreshed!.external_id).toBe(kept!.external_id);

    // A warm-up beside it (same minute, a tenth of the length) and a second
    // run ten minutes later are their own activities.
    const warmUp = await apiA.post('/api/activities', { data: { activity: gpxWire(T0 + 20_000, { n: 60 }) } });
    expect(warmUp.status(), await readErrorBody(warmUp)).toBe(201);
    const later = await apiA.post('/api/activities', { data: { activity: gpxWire(T0 + 20 * 60_000) } });
    expect(later.status(), await readErrorBody(later)).toBe(201);
    const { count: total } = await admin.from('activities').select('id', { count: 'exact', head: true }).eq('profile_id', a.id);
    expect(total).toBe(3);
  } finally {
    await Promise.all([apiA.dispose(), apiB.dispose(), anon.dispose()]);
    await deleteQaUser(a.id);
    await deleteQaUser(b.id);
  }
});

test('Settings → Connected apps: every source, an honest state, Disconnect @mobile', async ({ page }) => {
  test.skip(!tableThere, 'migration 247 not applied on this target');
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activity_connections').delete().eq('profile_id', alpha.id);

  // The surface flag: with it off the tab is neither listed nor reachable.
  await page.goto('/settings?tab=connections');
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible({ timeout: 20_000 });
  const tab = page.getByRole('button', { name: 'Connected apps', exact: true });
  if ((await tab.count()) === 0) {
    await expect(page.locator('[data-connected-apps]')).toHaveCount(0);
    test.skip(true, 'connected-apps flag off in this build');
    return;
  }

  try {
    // The deep link opened the tab; nothing is connected yet.
    const panel = page.locator('[data-connected-apps]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-connection]')).toHaveCount(CONNECTION_PROVIDERS.length);
    await expect(panel.locator('[data-connection-state="connected"]')).toHaveCount(0);
    // A source that cannot be connected yet says so, and offers no button.
    const garmin = panel.locator('[data-connection="garmin"]');
    await expect(garmin).toContainText('not taking new apps');
    await expect(garmin.getByRole('button')).toHaveCount(0);
    // The file import is always the way in.
    await expect(panel.getByRole('link', { name: 'Import a file' })).toHaveAttribute('href', '/activities/import');
    // No sideways scroll at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A connection appears as connected, with its Disconnect.
    await seedUploadLink(alpha.id);
    await page.reload();
    const watch = page.locator('[data-connection="upload_link"]');
    await expect(watch).toHaveAttribute('data-connection-state', 'connected', { timeout: 20_000 });
    await expect(watch).toContainText('Waiting for your first workout.');

    // Cancel keeps it; Disconnect removes it — the activities stay (the dialog says so).
    await watch.locator('[data-connection-disconnect]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Disconnect Apple Watch?');
    await expect(dialog).toContainText('The activities already in your Vitals stay.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(watch).toHaveAttribute('data-connection-state', 'connected');

    await watch.locator('[data-connection-disconnect]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(watch).not.toHaveAttribute('data-connection-state', 'connected', { timeout: 20_000 });
    await expect(watch.locator('[data-connection-disconnect]')).toHaveCount(0);
    const { count } = await admin.from('activity_connections').select('id', { count: 'exact', head: true }).eq('profile_id', alpha.id);
    expect(count).toBe(0);

    // The way in from Vitals and from the import screen.
    await page.goto('/athlete?tab=activities');
    await expect(page.locator('[data-activities-connect-link]')).toHaveAttribute('href', '/settings?tab=connections', { timeout: 20_000 });
    await page.goto('/activities/import');
    await expect(page.locator('[data-import-connect-hint]').getByRole('link')).toHaveAttribute('href', '/settings?tab=connections', { timeout: 20_000 });
  } finally {
    await admin.from('activity_connections').delete().eq('profile_id', alpha.id);
  }
});
