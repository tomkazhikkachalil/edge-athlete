import { purgePost } from './helpers/results';
import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Round 3: career / season rollups from athlete_performances. Alpha posts a
// hockey stat line (the performance writer mints its row); the rollups
// route answers one event with the schema's tiles and a best; a stranger
// to alpha's PRIVATE profile is refused; the Stats tab renders the rollup
// section on alpha's own page at phone width. The line is PRIVATE: since the
// gaps round (Sep 26 2026) the owner's sport card counts private lines too.
// @mobile

test('performance rollups: one stat line → one event, tiles and bests; a stranger is refused; the Stats tab renders it @mobile', async ({ page }) => {
  const alpha = loadQaUser('user.json');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const admin = adminClient();
  let postId: string | null = null;
  try {
    const post = await alphaApi.post('/api/posts', {
      // PRIVATE on purpose: the owner's card and rollups both count it. The
      // stranger check below is the PROFILE's privacy (the QA profiles are private).
      data: { caption: `Rollups hockey ${Date.now()}`, visibility: 'private', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-02-10', stats: { goals: 2, assists: 1, shots: 6 } } },
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
    // Its OWN point (points = goals + assists) — not the last: another spec in
    // the same run (contest-stat-lines) can leave alpha a later hockey line.
    expect(rollups.trend).toContainEqual(expect.objectContaining({ date: '2026-02-10', value: 3 }));

    // The owner's sport card counts the private line (skill-cards is the
    // viewer-dependent, privately cached reader; /u/'s CDN payload never does).
    const cardsRes = await alphaApi.get(`/api/profile/${alpha.id}/skill-cards`);
    expect(cardsRes.status(), await readErrorBody(cardsRes)).toBe(200);
    const hockey = ((await cardsRes.json()).skillCards as { sportKey: string; tiles: { label: string; value: string }[] }[]).find(c => c.sportKey === 'ice_hockey');
    expect(hockey, 'the owner sees a hockey card built from a private line').toBeTruthy();
    expect(Number(hockey!.tiles.find(t => t.label === 'Goals')?.value ?? 0)).toBeGreaterThanOrEqual(2);
    expect((await bravoApi.get(`/api/profile/${alpha.id}/skill-cards`)).status()).toBe(403);

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
    // At least its own two (a batch may add another spec's hockey line).
    const goalsTile = section.locator('[data-rollups-tile="Goals"]');
    await expect(goalsTile).toContainText(/\d/);
    expect(Number((await goalsTile.innerText()).match(/\d+/)?.[0] ?? 0)).toBeGreaterThanOrEqual(2);
    await expect(section.locator('[data-rollups-bests]')).toContainText('Shots');
  } finally {
    await purgePost(postId); // results are never deleted by the app (241) — the service role tears down
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});
