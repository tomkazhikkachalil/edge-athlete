import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadQaUser, resetGetStarted } from './helpers/qa-user';

// Download the app (Oct 2026) — Edge Athlete on the home screen, no store.
// A real install cannot be automated (it is the browser's own dialog, or on
// an iPhone three taps in Safari's chrome), so each DEVICE STATE is played:
// a user agent for the platform rule, a synthetic `beforeinstallprompt` for
// Android's one-tap install, `navigator.standalone` (and Chromium's emulated
// display-mode) for a window running from the icon. What is held here is
// the app's half: the right door, the right steps, and no invitation left
// once the app is installed.

const UA = {
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 338.0.0.26.86 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 615072868)',
};

const PHONE = { width: 390, height: 844 };

/** A signed-in phone with the given user agent. The QA account is brand new,
 *  so its Get Started card is dismissed up front unless the test wants it —
 *  the install card waits while that one shows. */
async function phone(browser: Browser, userAgent: string, opts: { getStarted?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', userAgent, viewport: PHONE });
  if (!opts.getStarted) {
    await ctx.addInitScript(() => {
      try {
        window.localStorage.setItem('ea:get-started:dismissed:v1', '1');
      } catch {
        // No storage: the card shows, and the spec fails loudly.
      }
    });
  }
  return ctx;
}

/** Hand the page the event Android Chrome fires when it is ready to install. */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __eaPrompted: number };
    w.__eaPrompted = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, {
      prompt: () => {
        w.__eaPrompted += 1;
        return Promise.resolve();
      },
    });
    window.dispatchEvent(e);
  });
}

const prompted = (page: Page) => page.evaluate(() => (window as unknown as { __eaPrompted?: number }).__eaPrompted ?? 0);

async function openMenu(page: Page) {
  const drawerToggle = page.getByRole('button', { name: 'Toggle mobile menu' });
  if (await drawerToggle.isVisible()) await drawerToggle.click();
  else await page.getByRole('button', { name: 'Account menu' }).click();
}

test('download the app: Android installs in one tap, and every invitation leaves once it is installed @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await phone(browser, UA.android);
  try {
    const page = await ctx.newPage();
    await page.goto('/feed');
    const card = page.locator('[data-install-card]');
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Before the browser offers an install, the button explains the menu route.
    await card.locator('[data-install-cta]').click();
    const guide = page.locator('[data-install-guide]');
    await expect(guide).toHaveAttribute('data-install-guide', 'android-menu');
    await expect(guide).toContainText('Install app');
    await page.getByRole('dialog', { name: 'Get the Edge Athlete app' }).getByRole('button', { name: 'Close' }).click();
    await expect(guide).toHaveCount(0);

    // The browser offers: the same button is now the install itself.
    await offerInstall(page);
    await card.locator('[data-install-cta]').click();
    await expect.poll(() => prompted(page)).toBe(1);
    await expect(guide).toHaveCount(0);

    // Installed: no card, no menu entry — and it stays that way on a reload.
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(card).toHaveCount(0);
    await openMenu(page);
    await expect(page.locator('[data-help-center-link]:visible')).toBeVisible();
    await expect(page.locator('[data-get-app]:visible')).toHaveCount(0);

    const again = await ctx.newPage();
    await again.goto('/feed');
    await expect(again.locator('[data-testid="post-card"], [data-feed-empty]').first()).toBeVisible({ timeout: 20_000 }).catch(() => null);
    await expect(again.locator('[data-install-card]')).toHaveCount(0);
    await again.goto('/settings');
    await expect(again.locator('[data-install-settings]')).toHaveAttribute('data-install-settings', 'installed');
  } finally {
    await ctx.close().catch(() => null);
  }
});

test('download the app: an iPhone gets the Share steps for ITS browser; the card is dismissed for good @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  // Safari: the three steps, from the feed card.
  const safari = await phone(browser, UA.iphoneSafari);
  try {
    const page = await safari.newPage();
    await page.goto('/feed');
    const card = page.locator('[data-install-card]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', PHONE.width);
    await card.locator('[data-install-cta]').click();
    const guide = page.locator('[data-install-guide]');
    await expect(guide).toHaveAttribute('data-install-guide', 'ios-safari');
    await expect(guide.locator('ol > li')).toHaveCount(3);
    await expect(guide).toContainText('Add to Home Screen');
    await expect(guide).toContainText("You'll sign in once inside the app.");
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);

    // Dismissed once is dismissed for good; the menu door stays.
    await card.getByRole('button', { name: 'Dismiss the app invitation' }).click();
    await expect(card).toHaveCount(0);
    const again = await safari.newPage();
    await again.goto('/settings');
    await expect(again.locator('[data-install-settings]')).toHaveAttribute('data-install-settings', 'invite');
    await openMenu(again);
    await again.locator('[data-get-app]:visible').click();
    await expect(again.locator('[data-install-guide]')).toHaveAttribute('data-install-guide', 'ios-safari');
    const feed = await safari.newPage();
    await feed.goto('/feed');
    await expect(feed.getByRole('button', { name: 'Toggle mobile menu' })).toBeVisible({ timeout: 20_000 });
    await expect(feed.locator('[data-install-card]')).toHaveCount(0);
  } finally {
    await safari.close().catch(() => null);
  }

  // Chrome on iOS: its own Share button, and the way out if the entry is missing.
  const chrome = await phone(browser, UA.iphoneChrome);
  try {
    const page = await chrome.newPage();
    await page.goto('/feed');
    await page.locator('[data-install-card] [data-install-cta]').click({ timeout: 20_000 });
    const guide = page.locator('[data-install-guide]');
    await expect(guide).toHaveAttribute('data-install-guide', 'ios-browser');
    await expect(guide).toContainText('in Safari');
  } finally {
    await chrome.close().catch(() => null);
  }

  // Another app's browser cannot add anything: open the real one first.
  const inApp = await phone(browser, UA.iphoneInstagram);
  try {
    const page = await inApp.newPage();
    await page.goto('/feed');
    await page.locator('[data-install-card] [data-install-cta]').click({ timeout: 20_000 });
    const guide = page.locator('[data-install-guide]');
    await expect(guide).toHaveAttribute('data-install-guide', 'ios-in-app');
    await expect(guide.getByRole('button', { name: 'Copy the link' })).toBeVisible();
  } finally {
    await inApp.close().catch(() => null);
  }
});

test('download the app: a new account sees Get Started first, never two cards — and closing it never summons the other @mobile', async ({ browser }) => {
  const alpha = loadQaUser('user.json');
  await resetGetStarted(alpha.id);
  const ctx = await phone(browser, UA.iphoneSafari, { getStarted: true });
  try {
    const page = await ctx.newPage();
    await page.goto('/feed');
    await expect(page.getByTestId('get-started-card')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-install-card]')).toBeHidden();
    // Closing one card must not slide another into its place ("the pop-up
    // came back", Tom, Oct 2026): the install card waits for the next visit.
    const saved = page.waitForResponse(r => r.url().includes('/api/profile/getting-started') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Dismiss get started checklist' }).click();
    await expect(page.getByTestId('get-started-card')).toHaveCount(0);
    await expect(page.locator('[data-install-card]')).toHaveCount(0);
    expect((await saved).ok()).toBe(true);

    const next = await ctx.newPage();
    await next.goto('/feed');
    await expect(next.locator('[data-install-card]')).toBeVisible({ timeout: 20_000 });
    await expect(next.getByTestId('get-started-card')).toHaveCount(0);
  } finally {
    await ctx.close().catch(() => null);
    // The dismissal is the ACCOUNT's now — put the shared QA user back.
    await resetGetStarted(alpha.id);
  }
});

test('download the app: opened from the icon, nothing invites and Settings says so @mobile', async ({ browser, browserName }) => {
  const ctx = await phone(browser, UA.iphoneSafari);
  try {
    // iOS's own flag for a window opened from the home screen.
    await ctx.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    });
    const page = await ctx.newPage();
    if (browserName === 'chromium') {
      // …and the standard one, where the engine can emulate it.
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
    }
    await page.goto('/settings');
    await expect(page.locator('[data-install-settings]')).toHaveAttribute('data-install-settings', 'using', { timeout: 20_000 });
    await openMenu(page);
    await expect(page.locator('[data-help-center-link]:visible')).toBeVisible();
    await expect(page.locator('[data-get-app]:visible')).toHaveCount(0);

    const feed = await ctx.newPage();
    await feed.goto('/feed');
    await expect(feed.getByRole('button', { name: 'Toggle mobile menu' })).toBeVisible({ timeout: 20_000 });
    await expect(feed.locator('[data-install-card]')).toHaveCount(0);
  } finally {
    await ctx.close().catch(() => null);
  }
});

test('download the app: the manifest, the desktop doors, the sign-in line, and a Back that is never dead', async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  // What a phone installs FROM.
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ id: '/feed', start_url: '/feed', scope: '/', display: 'standalone', name: 'Edge Athlete' });
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
  expect((await request.get('/apple-touch-icon.png')).status()).toBe(200);

  // A desktop with nothing to install: the menu door explains the phone route.
  await page.goto('/settings');
  await expect(page.locator('[data-install-settings]')).toHaveAttribute('data-install-settings', 'invite', { timeout: 20_000 });
  // Opened cold — a link in a new window, as the installed app opens one —
  // there is no history: Back leads to the feed, not nowhere. (A window
  // Playwright makes itself starts on about:blank, which IS a history entry.)
  const [cold] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(() => {
      window.open('/settings', '_blank');
    }),
  ]);
  await expect(cold.locator('[data-install-settings]')).toBeVisible({ timeout: 20_000 });
  expect(await cold.evaluate(() => window.history.length)).toBe(1);
  await cold.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(cold).toHaveURL(/\/feed$/, { timeout: 20_000 });
  await cold.close();

  const second = await page.context().newPage();
  await second.goto('/feed');
  await second.getByRole('button', { name: 'Account menu' }).click();
  await second.locator('[data-get-app]:visible').click();
  await expect(second.locator('[data-install-guide]')).toHaveAttribute('data-install-guide', 'desktop');
  await second.keyboard.press('Escape');
  // A desktop Chromium that offers an install: the same door is one click.
  await offerInstall(second);
  await second.getByRole('button', { name: 'Account menu' }).click();
  await second.locator('[data-get-app]:visible').click();
  await expect.poll(() => prompted(second)).toBe(1);
  await second.close();

  // Signed out: the sign-in page carries the door too.
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json', userAgent: UA.iphoneSafari, viewport: PHONE });
  try {
    const login = await anon.newPage();
    await login.goto('/?signin=1');
    await login.locator('[data-install-link]').click({ timeout: 20_000 });
    await expect(login.locator('[data-install-guide]')).toHaveAttribute('data-install-guide', 'ios-safari');
  } finally {
    await anon.close().catch(() => null);
  }
});
