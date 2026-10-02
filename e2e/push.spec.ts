import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { adminClient, E2E_TARGET, loadEnv, loadQaUser, resetGetStarted } from './helpers/qa-user';
import { startPushMock, type PushMock } from './helpers/push-mock';

// Phone notifications and the app icon's number (mig 248, Oct 2026). A real
// push to a real phone cannot be automated — the push services are Apple's,
// Google's and Mozilla's — so the two halves are proven apart:
//
//   the SERVER half, end to end: a turned-on device, a new notification, the
//   sweep, and the push service's request DECRYPTED by a stand-in
//   (e2e/helpers/push-mock.ts) — the exact payload a phone's worker reads —
//   then a device that says "gone" is pruned. On production, where no
//   stand-in exists, the every-minute pg_cron job is proven instead: it must
//   claim a QA notification and try the QA device by itself.
//
//   the DEVICE half, as far as a browser can play it: the worker registers
//   under the policy, an iPhone in a browser tab is told to use the home-
//   screen app, the installed app offers the switch and the feed card, and
//   the icon's number follows the bell.

loadEnv();

const PHONE = { width: 390, height: 844 };
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

async function insertNotification(userId: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await adminClient()
    .from('notifications')
    .insert({
      user_id: userId,
      type: 'comment',
      title: 'QA push test',
      message: `QA push ${Date.now()}`,
      action_url: '/feed?push-e2e=1',
      is_read: false,
      ...over,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function cleanup(userId: string, ids: string[]) {
  const admin = adminClient();
  if (ids.length > 0) await admin.from('notifications').delete().in('id', ids);
  await admin.from('push_subscriptions').delete().eq('profile_id', userId);
}

async function sweep(request: import('@playwright/test').APIRequestContext) {
  const response = await request.post('/api/push/sweep', {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test('phone notifications: a new notification is pushed once, decrypts to the right page, and a gone device is pruned', async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(E2E_TARGET === 'prod', 'the stand-in push service exists only beside the local server (the prod case is below)');
  test.skip(!process.env.CRON_SECRET, 'CRON_SECRET is not in the local env');
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const created: string[] = [];
  let mock: PushMock | null = null;
  try {
    mock = await startPushMock();
    await page.goto('/feed');

    // The config route offers the switch (the local server holds test keys).
    const config = await (await page.request.get('/api/push/config')).json();
    expect(config.enabled).toBe(true);

    // Anything other specs left for this account in the last few minutes is
    // considered first, so the counts below are this test's alone.
    await sweep(page.request);

    // A device turns notifications on.
    const device = mock.newDevice();
    const bad = await page.request.post('/api/push/subscriptions', {
      data: { endpoint: 'http://push.e2e.invalid/s/x', keys: { p256dh: device.p256dh, auth: device.auth } },
    });
    expect(bad.status()).toBe(400); // https only
    const on = await page.request.post('/api/push/subscriptions', {
      data: { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
    });
    expect(on.status()).toBe(201);
    const { data: row } = await admin.from('push_subscriptions').select('profile_id').eq('endpoint', device.endpoint).single();
    expect(row?.profile_id).toBe(user.id);

    // The sweep is the cron's: no secret, no sweep.
    expect((await page.request.post('/api/push/sweep')).status()).toBe(401);

    // Something happens → one sweep → one push, readable as the worker reads it.
    const id = await insertNotification(user.id);
    created.push(id);
    await sweep(page.request);
    const mine = () => mock!.deliveries.filter(d => d.deviceId === device.id);
    expect(mine()).toHaveLength(1);
    const delivered = mine()[0];
    expect(delivered.ttl).toBe('86400');
    expect(delivered.payload).toMatchObject({ id, title: 'QA push test', url: '/feed?push-e2e=1', tag: `n:${id}` });
    expect(delivered.payload?.badge as number).toBeGreaterThanOrEqual(1);
    const { data: stamped } = await admin.from('notifications').select('pushed_at').eq('id', id).single();
    expect(stamped?.pushed_at).toBeTruthy();

    // Never twice.
    await sweep(page.request);
    expect(mine()).toHaveLength(1);

    // A direct message never shows its words on the lock screen.
    const dm = await insertNotification(user.id, {
      type: 'new_message',
      title: 'QA sent you a message',
      message: 'the secret words',
      action_url: '/messages?c=00000000-0000-4000-8000-000000000000',
      metadata: { conversation_id: '00000000-0000-4000-8000-000000000000' },
    });
    created.push(dm);
    await sweep(page.request);
    expect(mine()).toHaveLength(2);
    expect(mine()[1].payload).toMatchObject({ title: 'QA sent you a message', body: 'Tap to read' });

    // The push service says the device is gone → the row goes with it.
    mock.answer(device.id, 410);
    created.push(await insertNotification(user.id));
    await sweep(page.request);
    const { data: gone } = await admin.from('push_subscriptions').select('id').eq('endpoint', device.endpoint);
    expect(gone).toHaveLength(0);

    // Turning off is the person's own: DELETE answers ok for their endpoint.
    const again = mock.newDevice();
    await page.request.post('/api/push/subscriptions', {
      data: { endpoint: again.endpoint, keys: { p256dh: again.p256dh, auth: again.auth } },
    });
    const off = await page.request.delete('/api/push/subscriptions', { data: { endpoint: again.endpoint } });
    expect(off.status()).toBe(200);
    const { data: offRow } = await admin.from('push_subscriptions').select('id').eq('endpoint', again.endpoint);
    expect(offRow).toHaveLength(0);
  } finally {
    await mock?.close();
    await cleanup(user.id, created);
  }
});

test('phone notifications on production: the every-minute job claims a new notification by itself (and tries the device once the keys exist)', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(E2E_TARGET !== 'prod', 'the push-sweep pg_cron job runs on production only');
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const created: string[] = [];
  try {
    await page.goto('/feed');
    const config = await (await page.request.get('/api/push/config')).json();
    // With keys: a device that can never be reached (an .invalid host) — the
    // job must still record its failed try. Without keys there is no device
    // to try, and the job must still CLAIM the row (it stamps everything it
    // considers), which is what proves it runs.
    const device = {
      endpoint: `https://push.e2e.invalid/s/prod-${Date.now()}`,
      p256dh: 'BOYdFSS2g7umny-o552Z5dPq8wyGTLxFeaYk7Hltx5Xc8tXFYbiTzsaTyrGsWRqWUeIZL1heJBmVH9UHUHTn41Y',
      auth: 'AAAAAAAAAAAAAAAAAAAAAA',
    };
    if (config.enabled === true) {
      const on = await page.request.post('/api/push/subscriptions', {
        data: { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      });
      expect(on.status()).toBe(201);
    }
    const id = await insertNotification(user.id);
    created.push(id);
    await expect
      .poll(
        async () => {
          const { data } = await admin.from('notifications').select('pushed_at').eq('id', id).single();
          return Boolean(data?.pushed_at);
        },
        { timeout: 150_000, intervals: [5_000] }
      )
      .toBe(true);
    if (config.enabled === true) {
      const { data: sub } = await admin.from('push_subscriptions').select('failure_count').eq('endpoint', device.endpoint).maybeSingle();
      expect(sub?.failure_count ?? 0).toBeGreaterThanOrEqual(1);
    }
  } finally {
    await cleanup(user.id, created);
  }
});

async function installedPhone(
  browser: Browser,
  userAgent: string,
  opts: { permission?: 'default' } = {}
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', userAgent, viewport: PHONE });
  if (opts.permission) {
    // Headless browsers answer 'denied' and cannot be asked; a phone that has
    // not been asked yet answers 'default' — the device state is played.
    await ctx.addInitScript((value: string) => {
      if (typeof Notification === 'function') {
        Object.defineProperty(Notification, 'permission', { configurable: true, get: () => value });
      }
    }, opts.permission);
  }
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem('ea:get-started:dismissed:v1', '1');
    } catch {
      // No storage: the card shows, and the spec fails loudly.
    }
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    // Record what the app puts on its icon.
    const w = window as unknown as { __badges: number[] };
    w.__badges = [];
    Object.defineProperty(window.navigator, 'setAppBadge', {
      configurable: true,
      value: (n?: number) => {
        w.__badges.push(n ?? 0);
        return Promise.resolve();
      },
    });
    Object.defineProperty(window.navigator, 'clearAppBadge', {
      configurable: true,
      value: () => {
        w.__badges.push(0);
        return Promise.resolve();
      },
    });
  });
  return ctx;
}

test('phone notifications: the worker registers, an iPhone tab is sent to the home-screen app, the installed app offers the switch, and the icon follows the bell @mobile', async ({ browser, browserName, page }) => {
  test.setTimeout(150_000);
  const user = loadQaUser('user.json');
  const created: string[] = [];
  try {
    // The feed's cards wait behind Get Started, whose dismissal is the
    // ACCOUNT's — close it for this account, and put it back afterwards.
    const dismissed = await page.request.post('/api/profile/getting-started', { data: { dismiss: true } });
    expect(dismissed.ok()).toBe(true);

    // The worker is allowed by the policy and served from the root.
    await page.goto('/feed');
    const csp = (await page.request.get('/feed')).headers()['content-security-policy'] ?? '';
    if (csp) expect(csp).toContain("worker-src 'self'");
    // (Never unregistered afterwards: the app itself never unregisters, and
    // Playwright's WebKit hangs a later register() on an origin whose worker
    // was unregistered in the same browser.)
    const scope = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg =
        (await navigator.serviceWorker.getRegistration('/')) ??
        (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
      return reg.scope;
    });
    if (scope !== 'unsupported') expect(scope).toBe(new URL('/', page.url()).href);
    const sw = await page.request.get('/sw.js');
    expect(sw.status()).toBe(200);
    expect(await sw.text()).toContain("addEventListener('push'");

    const config = await (await page.request.get('/api/push/config')).json();
    test.skip(config.enabled !== true, 'the deployment holds no VAPID keys yet');

    // An iPhone in Safari: notifications live in the home-screen app.
    const tab = await browser.newContext({ storageState: 'e2e/.auth/state.json', userAgent: IPHONE_SAFARI, viewport: PHONE });
    try {
      const p = await tab.newPage();
      await p.goto('/settings?tab=notifications');
      await expect(p.locator('[data-push-settings]')).toHaveAttribute('data-push-settings', 'needs-install', { timeout: 20_000 });
      await expect(p.locator('[data-push-settings]')).toContainText('home screen');
    } finally {
      await tab.close();
    }

    // Blocked on the device: Settings says where to undo it, and no switch.
    if (browserName === 'chromium') {
      const blocked = await installedPhone(browser, ANDROID);
      try {
        const p = await blocked.newPage();
        const cdp = await blocked.newCDPSession(p);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
        await p.goto('/settings?tab=notifications');
        await expect(p.locator('[data-push-settings]')).toHaveAttribute('data-push-settings', 'denied', { timeout: 20_000 });
        await expect(p.getByRole('switch', { name: 'Phone notifications on this device' })).toHaveCount(0);
        await p.goto('/feed');
        await expect(p.getByRole('button', { name: /Notifications/ }).first()).toBeVisible({ timeout: 20_000 });
        await expect(p.locator('[data-push-card]')).toHaveCount(0);
      } finally {
        await blocked.close();
      }
    }

    // Two unread things, then the installed app (Android, where the engine
    // has the push APIs): the icon shows the bell's number, and reading
    // everything clears it.
    created.push(await insertNotification(user.id), await insertNotification(user.id));
    const ctx = await installedPhone(browser, ANDROID, { permission: 'default' });
    try {
      const p = await ctx.newPage();
      if (browserName === 'chromium') {
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
      }
      await p.goto('/feed');
      const lastBadge = () => p.evaluate(() => {
        const list = (window as unknown as { __badges: number[] }).__badges;
        return list.length ? list[list.length - 1] : -1;
      });
      await expect.poll(lastBadge, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

      if (browserName === 'chromium') {
        // The installed app invites on the feed, and keeps inviting until the
        // person chooses: "Not now" puts it away for a week (a reload keeps
        // it away), and a week later it asks again.
        const card = p.locator('[data-push-card]');
        await expect(card).toBeVisible({ timeout: 20_000 });
        await card.locator('[data-push-not-now]').click();
        await expect(card).toHaveCount(0);
        await p.reload();
        await expect(p.getByRole('button', { name: /Notifications/ }).first()).toBeVisible({ timeout: 20_000 });
        await expect(card).toHaveCount(0);
        const snoozed = await p.evaluate(() => window.localStorage.getItem('ea:push-card:snoozed-until:v1'));
        const days = (Date.parse(snoozed ?? '') - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(6.9);
        expect(days).toBeLessThanOrEqual(7);
        await p.evaluate(() =>
          window.localStorage.setItem('ea:push-card:snoozed-until:v1', new Date(Date.now() - 1000).toISOString())
        );
        await p.reload();
        await expect(card).toBeVisible({ timeout: 20_000 });
        // …and Settings carries the switch.
        await p.goto('/settings?tab=notifications');
        await expect(p.locator('[data-push-settings]')).toHaveAttribute('data-push-settings', 'available', { timeout: 20_000 });
        await expect(p.getByRole('switch', { name: 'Phone notifications on this device' })).toHaveAttribute('aria-checked', 'false');
      }

      await p.goto('/app/notifications');
      await p.getByRole('button', { name: /Mark all read/ }).first().click();
      await expect.poll(lastBadge, { timeout: 15_000 }).toBe(0);
    } finally {
      await ctx.close();
    }
  } finally {
    await cleanup(user.id, created);
    await resetGetStarted(user.id);
  }
});
