import { test } from './helpers/test';
import { adminClient, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
// ONE-OFF header captures (bigger logo try) — not committed.
const OUT = process.env.SHOT_DIR!;
test('@mobile header shots', async ({ browser }) => {
  test.setTimeout(180_000);
  const u = await createQaUser({ displayName: 'Logo Lee' });
  try {
    for (const mode of ['off', 'on'] as const) {
      await adminClient().from('profiles').update({ theme_prefs: { mode } }).eq('id', u.id);
      for (const w of [1280, 375, 320]) {
        if (mode === 'on' && w === 320) continue;
        const ctx = await browser.newContext({ storageState: await mintStorageState(u), viewport: { width: w, height: 700 } });
        await ctx.addInitScript(m => { try { localStorage.setItem('ea:theme:v1', JSON.stringify({ mode: m })); } catch {} }, mode);
        const page = await ctx.newPage();
        await page.goto('/feed');
        await page.locator('header button[aria-label="Edge Athlete — go to feed"]').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${OUT}/${mode === 'on' ? 'dark' : 'light'}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 80 } });
        await ctx.close();
      }
    }
  } finally { await deleteQaUser(u.id); }
});
