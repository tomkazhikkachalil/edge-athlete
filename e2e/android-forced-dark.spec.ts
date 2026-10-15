import { test, expect, chromium, devices, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { createQaUser, deleteQaUser, mintStorageState, type QaUser } from './helpers/qa-user';

// Android's forced dark mode must not repaint our LIGHT theme (Oct 15 2026).
//
// Reported: light mode looked wrong on Android, right on iPhone. Chrome for
// Android ("Darken websites" / Auto Dark Theme) and Samsung Internet darken
// any page that does not say it has its own dark theme — and the light theme
// said `color-scheme: light`, which reads as "light only, darken me". iOS
// Safari never does this. The fix is `color-scheme: only light` / `only dark`
// on the root (Chrome's documented opt-out) plus `<meta name="color-scheme"
// content="light dark">` (Samsung's signal that the site themes itself).
//
// Forced dark happens at PAINT time — computed styles never change — so this
// reads pixels: Chromium's own force-dark switch, a dark-OS phone, and the
// mean brightness of the screen.

let user: QaUser | null = null;
let state: Awaited<ReturnType<typeof mintStorageState>> | null = null;
let browser: Browser | null = null;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== 'chromium') return;
  // Shared QA defaults pin the theme to LIGHT (helpers/qa-user.ts QA_THEME_PREFS).
  user = await createQaUser({ displayName: 'Edge QA Forced Dark', firstName: 'Edge', lastName: 'Dark' });
  state = await mintStorageState(user);
  browser = await chromium.launch({ args: ['--blink-settings=forceDarkModeEnabled=true'] });
});

test.afterAll(async () => {
  await browser?.close();
  if (user) await deleteQaUser(user.id);
});

async function meanBrightness(png: Buffer): Promise<number> {
  const { channels } = await sharp(png).removeAlpha().stats();
  return (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
}

test('@mobile the light theme stays light under Android forced dark', async ({ browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'forced dark is a Chromium (Android) behaviour');
  const ctx = await browser!.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', storageState: state!, baseURL });
  try {
    const page = await ctx.newPage();
    await page.goto('/feed');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    await page.waitForLoadState('networkidle').catch(() => {});
    const brightness = await meanBrightness(await page.screenshot());
    // The light canvas is #f9fafb with white cards: well above 200. A
    // force-darkened page sits far below 100.
    expect(brightness, `mean brightness ${brightness.toFixed(0)}`).toBeGreaterThan(180);
  } finally {
    await ctx.close();
  }
});
