import { purgePost } from './helpers/results';
import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Round 3: career / season rollups from athlete_performances. Alpha posts a
// hockey stat line (the performance writer mints its row); the rollups
// route answers one event with the schema's tiles and a best; a stranger
// to alpha's PRIVATE profile is refused; the Stats tab renders the rollup
// section on alpha's own page at phone width. @mobile

test('performance rollups: one stat line → one event, tiles and bests; a stranger is refused; the Stats tab renders it @mobile', async ({ page }) => {
  const alpha = loadQaUser('user.json');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const admin = adminClient();
  let postId: string | null = null;
  try {
    const post = await alphaApi.post('/api/posts', {
      // PUBLIC: the Stats tab's sport cards are built from public posts (the
      // owner's private lines reach the rollups API, not the card — a product
      // gap recorded in the DEVLOG). The stranger check below is the PROFILE's
      // privacy (the QA profiles are private).
      data: { caption: `Rollups hockey ${Date.now()}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-02-10', stats: { goals: 2, assists: 1, shots: 6 } } },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    postId = (await post.json()).post.id as string;
    let row: { id: string } | null = null;
    for (let i = 0; i < 20 && !row; i++) {
      const { data } = await admin.from('athlete_performances').select('id').eq('natural_key', `post:${postId}`).maybeSingle();
      row = data;
      if (!row) await new Promise(r => setTimeout(r, 500));
    }
    test.skip(!row, 'athlete_performances not live (pre-194)');

    const res = await alphaApi.get(`/api/performance/rollups?profileId=${alpha.id}&sport=ice_hockey`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { rollups } = await res.json();
    expect(rollups.events).toBeGreaterThanOrEqual(1);
    expect(rollups.seasons.some((s: { key: string }) => s.key === '2025-26')).toBe(true);
    const season = rollups.seasons.find((s: { key: string }) => s.key === '2025-26');
    expect(season.tiles.find((t: { label: string }) => t.label === 'Goals').value).toBe('2');
    expect(season.bests.find((b: { key: string }) => b.key === 'shots')).toMatchObject({ value: 6, date: '2026-02-10' });
    expect(rollups.trend.at(-1)).toMatchObject({ date: '2026-02-10', value: 3 }); // points = goals + assists

    // A stranger to a private profile.
    expect((await bravoApi.get(`/api/performance/rollups?profileId=${alpha.id}&sport=ice_hockey`)).status()).toBe(403);
    expect((await alphaApi.get(`/api/performance/rollups?profileId=${alpha.id}&sport=curling`)).status()).toBe(400);

    // The Stats tab on the owner's page.
    await page.goto(`/athlete/${alpha.id}?tab=stats&sport=ice_hockey`);
    // The sport layer opens on a summary; the breakdown (and the rollups at
    // its top) is behind "Full breakdown".
    await page.getByRole('button', { name: 'Full breakdown' }).click();
    const section = page.locator('[data-rollups]');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.locator('[data-rollups-tile="Goals"]')).toContainText('2');
    await expect(section.locator('[data-rollups-bests]')).toContainText('Shots');
  } finally {
    await purgePost(postId); // results are never deleted by the app (241) — the service role tears down
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});
