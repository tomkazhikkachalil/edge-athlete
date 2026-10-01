import { randomBytes } from 'node:crypto';
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { parseGpx } from '../src/lib/activities/parse-gpx';
import { toWire } from '../src/lib/activities/wire';
import { gpxOf, healthWorkout, line } from '../src/lib/activities/__tests__/fixtures';
import { fitRun as fitBytes } from './helpers/fit';

// Fix round part 3, PR 3 (Oct 1 2026): the Apple Watch path. Apple has no web
// API, so a bridge app on the iPhone POSTs each workout to the athlete's
// personal upload link. The link has NO session — the token is the
// authorization — so this spec is mostly about what the token may and may not
// do: one 404 for every dead link, the supervised and moderation refusals,
// one activity however many times it arrives.

async function ctxFor(u: QaUser | null): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: E2E_BASE_URL,
    storageState: u ? await mintStorageState(u) : { cookies: [], origins: [] },
    extraHTTPHeaders: bypassHeaders(),
  });
}

/** The link's path on THIS target (the minted URL carries the public host). */
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

let tableThere = true;

test.beforeAll(async () => {
  const probe = await adminClient().from('activity_connections').select('id').limit(1);
  tableThere = !(probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'));
});

test('upload link: mint, deliveries (bridge JSON, GPX, FIT), one activity each, rotate, the refusals', async () => {
  test.skip(!tableThere, 'migration 247 not applied on this target');
  test.setTimeout(240_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Link Ada', firstName: 'Link', lastName: 'Ada' });
  const [apiA, phone] = await Promise.all([ctxFor(a), ctxFor(null)]);
  const count = async () => (await admin.from('activities').select('id', { count: 'exact', head: true }).eq('profile_id', a.id)).count;
  const linkView = async () => (await (await apiA.get('/api/connections')).json()).connections.find((c: { provider: string }) => c.provider === 'upload_link');
  // Whole seconds, hours apart, all inside the last day.
  const NOW = Math.floor(Date.now() / 1000) * 1000;
  const RUN_A = NOW - 20 * 3_600_000; // the bridge app's run
  const RUN_B = NOW - 14 * 3_600_000; // a raw GPX
  const RUN_C = NOW - 8 * 3_600_000; // a raw FIT

  try {
    // Before a link exists the card offers one.
    expect((await linkView()).state).toBe('available');

    // Signed out: no link for you.
    expect((await phone.post('/api/connections/upload-link')).status()).toBe(401);

    // Mint: the URL comes back once; only its hash is stored.
    const minted = await apiA.post('/api/connections/upload-link', { data: { tz: 'America/Toronto' } });
    expect(minted.status(), await readErrorBody(minted)).toBe(200);
    const { url, rotated } = await minted.json();
    expect(rotated).toBe(false);
    expect(url).toMatch(/\/api\/activities\/inbound\/[A-Za-z0-9_-]{43}\?tz=America%2FToronto$/);
    expect(new URL(url).origin).toBe(new URL(E2E_BASE_URL).origin);
    const link = pathOf(url);
    const token = link.split('/').pop()!.split('?')[0];
    const { data: stored } = await admin.from('activity_connections').select('token_hash, secret_ciphertext, status').eq('profile_id', a.id).single();
    expect(stored!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.token_hash).not.toContain(token);
    expect(stored!.secret_ciphertext).toBeNull();
    expect((await linkView())).toMatchObject({ state: 'connected', lastSyncAt: null });

    // ── The bridge app's delivery (no session — the phone's automation) ────
    const exportBody = { data: { workouts: [healthWorkout(RUN_A)] } };
    const first = await phone.post(link, { data: exportBody });
    expect(first.status(), await readErrorBody(first)).toBe(200);
    expect(await first.json()).toMatchObject({ received: 1, imported: 1, duplicates: 0, refused: [], skipped: 0 });
    const { data: runA } = await admin.from('activities').select('*').eq('profile_id', a.id).single();
    expect(runA).toMatchObject({
      source: 'upload_link',
      source_format: null,
      external_id: '5F0E3C4A-9B1D-4E2F-8A77-0C1D2E3F4A5B',
      activity_type: 'run',
      has_route: true,
      elapsed_s: 1800,
      calories: 410,
      only_me: false,
    });
    expect(Date.parse(runA!.started_at)).toBe(RUN_A);
    expect(runA!.avg_hr).toBeGreaterThan(148);
    expect(Number(runA!.distance_m)).toBeGreaterThan(5300);
    expect(runA!.post_id).toBeNull(); // it appears in Vitals; the athlete shares

    // The app re-sends the same workout on its next sync: still one.
    const resent = await phone.post(link, { data: exportBody });
    expect(await resent.json()).toMatchObject({ received: 1, imported: 0, duplicates: 1 });
    expect(await count()).toBe(1);

    // The athlete also imports the FILE of that run by hand: the same activity.
    const parsed = parseGpx(gpxOf(line(1800, { t0: RUN_A + 2000, stepM: 3, hr: 150 })));
    const byHand = await apiA.post('/api/activities', { data: { activity: toWire({ ...parsed, format: 'gpx' }, 'America/Toronto') } });
    expect(byHand.status(), await readErrorBody(byHand)).toBe(200);
    expect(await byHand.json()).toMatchObject({ id: runA!.id, duplicate: true });
    expect(await count()).toBe(1);

    // ── A raw GPX and a raw FIT posted to the same link ───────────────────
    const gpx = await phone.post(link, { headers: { 'Content-Type': 'application/gpx+xml' }, data: Buffer.from(gpxOf(line(1200, { t0: RUN_B, stepM: 3, hr: 150 }))) });
    expect(gpx.status(), await readErrorBody(gpx)).toBe(200);
    expect(await gpx.json()).toMatchObject({ received: 1, imported: 1 });
    const fit = await phone.post(link, { headers: { 'Content-Type': 'application/octet-stream' }, data: fitBytes(RUN_C) });
    expect(fit.status(), await readErrorBody(fit)).toBe(200);
    expect(await fit.json()).toMatchObject({ received: 1, imported: 1 });
    const fitAsForm = await phone.post(link, { multipart: { file: { name: 'run.fit', mimeType: 'application/octet-stream', buffer: fitBytes(RUN_C) } } });
    expect(await fitAsForm.json()).toMatchObject({ received: 1, imported: 0, duplicates: 1 });
    const { data: rows } = await admin.from('activities').select('source, source_format, timezone, occurred_on').eq('profile_id', a.id).order('started_at');
    expect(rows!.map(r => `${r.source}:${r.source_format}`)).toEqual(['upload_link:null', 'upload_link:gpx', 'upload_link:fit']);
    // The link's ?tz= places a file with no offset of its own.
    expect(rows![1].timezone).toBe('America/Toronto');

    // The connection knows it synced.
    const synced = await linkView();
    expect(synced.state).toBe('connected');
    expect(typeof synced.lastSyncAt).toBe('string');

    // "Nothing new" is a sync too.
    const empty = await phone.post(link, { data: { data: { workouts: [] } } });
    expect(await empty.json()).toMatchObject({ received: 0, imported: 0 });

    // An implausible workout is refused by name inside a 200 (a retry would not fix it).
    const flying = healthWorkout(NOW - 3 * 3_600_000, { id: 'A1B2C3D4-0000-4000-8000-000000000001', distance: { qty: 900, units: 'km' }, route: undefined }, 10);
    const refusedRes = await phone.post(link, { data: { data: { workouts: [flying] } } });
    expect(refusedRes.status()).toBe(200);
    const refusedBody = await refusedRes.json();
    expect(refusedBody).toMatchObject({ received: 1, imported: 0 });
    expect(refusedBody.refused[0]).toMatch(/faster than/);
    expect(await count()).toBe(3);

    // ── A body the link does not take: said so, and the card shows it ─────
    const junk = await phone.post(link, { headers: { 'Content-Type': 'text/plain' }, data: 'hello' });
    expect(junk.status()).toBe(415);
    expect((await linkView())).toMatchObject({ state: 'needs_attention' });
    // …and the next good delivery heals it.
    await phone.post(link, { data: { data: { workouts: [] } } });
    expect((await linkView()).state).toBe('connected');

    // ── Dead links: one 404, whatever the reason ──────────────────────────
    const other = `/api/activities/inbound/${randomBytes(32).toString('base64url')}`;
    expect((await phone.post(other, { data: exportBody })).status()).toBe(404);
    expect((await phone.post('/api/activities/inbound/short', { data: exportBody })).status()).toBe(404);
    expect((await phone.get(link)).status()).toBe(405);

    // A limited account's link is refused by the write gate.
    await admin.from('profiles').update({ moderation_state: 'limited' }).eq('id', a.id);
    try {
      expect((await phone.post(link, { data: exportBody })).status()).toBe(403);
      expect((await apiA.post('/api/connections/upload-link')).status()).toBe(403);
    } finally {
      await admin.from('profiles').update({ moderation_state: 'active' }).eq('id', a.id);
    }

    // A supervised account: the link is dead and none can be made.
    await admin.from('profiles').update({ supervision_state: 'supervised' }).eq('id', a.id);
    try {
      expect((await phone.post(link, { data: exportBody })).status()).toBe(404);
      const refusedMint = await apiA.post('/api/connections/upload-link');
      expect(refusedMint.status()).toBe(403);
      expect((await refusedMint.json()).error).toMatch(/supervised/);
    } finally {
      await admin.from('profiles').update({ supervision_state: 'self' }).eq('id', a.id);
    }

    // Rotate: the old link stops at once, the new one works, the history stays.
    const again = await apiA.post('/api/connections/upload-link');
    expect(again.status(), await readErrorBody(again)).toBe(200);
    const next = await again.json();
    expect(next.rotated).toBe(true);
    expect(pathOf(next.url)).not.toBe(link);
    expect((await phone.post(link, { data: exportBody })).status()).toBe(404);
    expect((await phone.post(pathOf(next.url), { data: { data: { workouts: [] } } })).status()).toBe(200);
    expect(typeof (await linkView()).lastSyncAt).toBe('string');

    // Disconnect: the link dies; the activities stay — they are the athlete's.
    expect((await apiA.delete('/api/connections/upload_link')).status()).toBe(200);
    expect((await phone.post(pathOf(next.url), { data: exportBody })).status()).toBe(404);
    expect(await count()).toBe(3);
  } finally {
    await Promise.all([apiA.dispose(), phone.dispose()]);
    await deleteQaUser(a.id);
  }
});

test('Settings → Apple Watch: create the link, it is shown once, a delivery lands in Vitals @mobile', async ({ page }) => {
  test.skip(!tableThere, 'migration 247 not applied on this target');
  test.setTimeout(120_000);
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activity_connections').delete().eq('profile_id', alpha.id);
  const START = Math.floor(Date.now() / 1000) * 1000 - 2 * 3_600_000;

  await page.goto('/settings?tab=connections');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible({ timeout: 20_000 });
  if ((await page.getByRole('button', { name: 'Connected apps' }).count()) === 0) {
    test.skip(true, 'connected-apps flag off in this build');
    return;
  }

  let activityId: string | null = null;
  try {
    const watch = page.locator('[data-connection="upload_link"]');
    await expect(watch).toHaveAttribute('data-connection-state', 'available', { timeout: 20_000 });
    // The steps are open before a link exists, and name the app's own labels.
    await expect(watch).toContainText('Health Auto Export');
    await expect(watch).toContainText('Include Route Data');

    await watch.locator('[data-upload-link-create]').click();
    const field = watch.locator('#upload-link-url');
    await expect(field).toBeVisible({ timeout: 20_000 });
    const url = await field.inputValue();
    expect(url).toMatch(/\/api\/activities\/inbound\/[A-Za-z0-9_-]{43}/);
    // The link comes back to the host the athlete is ON (the token exists
    // only in this environment), and once it is on screen "Create" is gone —
    // a second tap there would replace the link just shown. Checked at once,
    // not after a wait: the list reloads a moment later.
    expect(new URL(url).origin).toBe(new URL(E2E_BASE_URL).origin);
    expect(await watch.locator('[data-upload-link-create]').count()).toBe(0);
    await expect(watch).toHaveAttribute('data-connection-state', 'connected');
    await expect(watch).toContainText('This is the only time the link is shown.');
    await expect(watch.locator('[data-upload-link-copy]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The phone's delivery (no session).
    const u = new URL(url);
    const phone = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
    try {
      const sent = await phone.post(u.pathname + u.search, { data: { data: { workouts: [healthWorkout(START, { id: `E2E-${randomBytes(8).toString('hex')}` })] } } });
      expect(sent.status(), await readErrorBody(sent)).toBe(200);
      expect((await sent.json()).imported).toBe(1);
    } finally {
      await phone.dispose();
    }
    const { data: row } = await admin.from('activities').select('id').eq('profile_id', alpha.id).eq('source', 'upload_link').order('created_at', { ascending: false }).limit(1).single();
    activityId = row!.id as string;

    // After a reload the link itself is gone (shown once); the card says it synced.
    await page.reload();
    await expect(watch).toHaveAttribute('data-connection-state', 'connected', { timeout: 20_000 });
    await expect(watch).toContainText('Last workout received');
    await expect(watch.locator('#upload-link-url')).toHaveCount(0);

    // "Make a new link" asks first, then shows a DIFFERENT link.
    await watch.locator('[data-upload-link-replace]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Your current link stops working at once.');
    await dialog.getByRole('button', { name: 'Make a new link' }).click();
    await expect(watch.locator('#upload-link-url')).toBeVisible({ timeout: 20_000 });
    expect(await watch.locator('#upload-link-url').inputValue()).not.toBe(url);

    // The workout is in Vitals — a session this week, not a feed post.
    await page.goto('/athlete?tab=vitals');
    await expect(page.locator('[data-vitals-recent-sessions] [data-session-kind="activity"]').first()).toBeVisible({ timeout: 20_000 });
    const { data: stored } = await admin.from('activities').select('post_id').eq('id', activityId).single();
    expect(stored!.post_id).toBeNull();
  } finally {
    await admin.from('activity_connections').delete().eq('profile_id', alpha.id);
    if (activityId) {
      const { data: row } = await admin.from('activities').select('stream_path').eq('id', activityId).maybeSingle();
      if (row?.stream_path) await admin.storage.from('uploads').remove([row.stream_path]);
      await admin.from('activities').delete().eq('id', activityId);
    }
  }
});
