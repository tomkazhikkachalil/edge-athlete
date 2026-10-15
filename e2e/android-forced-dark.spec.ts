import { test, expect, chromium, devices, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { adminClient, createQaUser, deleteQaUser, mintStorageState, type QaUser } from './helpers/qa-user';

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

// Checkboxes, radios and ranges wear the theme's violet, not Android's teal:
// one token, lighter in dark (globals.css --control-accent).
test('@mobile native controls take the theme accent in light and dark', async ({ browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for a computed colour');
  for (const [mode, rgb] of [['off', 'rgb(124, 58, 237)'], ['on', 'rgb(139, 92, 246)']] as const) {
    const { error } = await adminClient().from('profiles').update({ theme_prefs: { mode } }).eq('id', user!.id);
    if (error) throw new Error(error.message);
    const ctx = await browser!.newContext({ ...devices['Pixel 7'], storageState: state!, baseURL });
    try {
      const page = await ctx.newPage();
      // The mirror in the minted state is pinned light; the cookie-less first
      // load reads it, so write the mode into the mirror before any script.
      await ctx.addInitScript(m => { try { localStorage.setItem('ea:theme:v1', JSON.stringify({ mode: m })); } catch {} }, mode);
      await page.goto('/feed');
      if (mode === 'on') await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      else await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
      const accent = await page.evaluate(() => {
        const box = document.createElement('input');
        box.type = 'checkbox';
        document.body.appendChild(box);
        return getComputedStyle(box).accentColor;
      });
      expect(accent, `theme ${mode}`).toBe(rgb);
    } finally {
      await ctx.close();
    }
  }
});
