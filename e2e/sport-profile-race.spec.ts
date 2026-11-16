import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// A race sport's profile ("one wave", phase 4 — Nov 2026): a race does not
// add up as a whole, but each column has its own rule — distance and time
// are totals, a pace is the season's best and opens the run it was set in.

interface Payload { supported: boolean; sums: boolean; columns: Array<{ key: string; rule: string; format: string }>; career: { games: number; totals: Record<string, number>; bestIn: Record<string, string> }; seasons: Array<{ key: string; games: number; totals: Record<string, number>; bestIn: Record<string, string> }>; games: Array<{ key: string; date: string | null }> }

test('running\'s profile: distance and time add up, the pace is the best and opens its run — at 375 px @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const runner = await createQaUser({ displayName: 'Rae Runner', firstName: 'Rae', lastName: 'Runner' });
  const state = await mintStorageState(runner);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: state, extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    const run = async (date: string, stats: Record<string, number>) => {
      const res = await api.post('/api/posts', { data: { caption: `QA run ${date}`, visibility: 'private', postType: 'running', stats_data: { type: 'stat_line', sport_key: 'running', date, stats } } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      return (await res.json()).post.id as string;
    };
    await run('2026-03-01', { distance_km: 10, moving_s: 3000, pace_s_per_km: 300, avg_hr: 150 });
    const fast = await run('2026-04-01', { distance_km: 5, moving_s: 1400, pace_s_per_km: 280, avg_hr: 160 });
    await run('2025-10-01', { distance_km: 21, moving_s: 7140, pace_s_per_km: 340 });

    // ── The read: each column by its own rule; the best names its run.
    const res = await api.get(`/api/profile/${runner.id}/sport-profile?sport=running`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const p = (await res.json()) as Payload;
    expect(p).toMatchObject({ supported: true, sums: false });
    const rule = (k: string) => p.columns.find(c => c.key === k);
    expect(rule('distance_km')).toMatchObject({ rule: 'sum', format: 'number' });
    expect(rule('moving_s')).toMatchObject({ rule: 'sum', format: 'clock' });
    expect(rule('pace_s_per_km')).toMatchObject({ rule: 'low', format: 'clock' });
    expect(rule('avg_hr')).toMatchObject({ rule: 'avg' });
    expect(p.career.totals).toMatchObject({ distance_km: 36, moving_s: 11540, pace_s_per_km: 280, avg_hr: 155 });
    expect(p.career.bestIn.pace_s_per_km).toBe(`post:${fast}`);
    const y2026 = p.seasons.find(s => s.key === '2026')!;
    expect(y2026.totals).toMatchObject({ distance_km: 15, pace_s_per_km: 280 });
    expect(p.seasons.find(s => s.key === '2025')!.totals.pace_s_per_km).toBe(340);

    // ── The screen: the columns show, the pace reads as a clock and opens the run it was set in.
    const page = await ctx.newPage();
    await page.goto(`/athlete/${runner.id}/sport/running`);
    const career = page.locator('[data-sport-level="career"]');
    await expect(career.locator('[data-sport-no-sums]')).toBeVisible({ timeout: 40_000 });
    const row2026 = career.locator('[data-stat-row="2026"]');
    await expect(row2026.locator('[data-stat="distance_km"]')).toHaveText('15');
    await expect(row2026.locator('[data-stat="moving_s"]')).toHaveText('1:13:20');
    await expect(row2026.locator('[data-stat="pace_s_per_km"]')).toHaveText('4:40');
    await expect(career.locator('[data-stat-row="career"] [data-stat="pace_s_per_km"]')).toHaveText('4:40');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await row2026.locator('[data-stat="pace_s_per_km"] a').click();
    await expect(page).toHaveURL(new RegExp(`season=2026&game=${encodeURIComponent(`post:${fast}`)}$`));
    await expect(page.locator('[data-sport-level="game"]')).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    // The season: its totals and bests in one row; no splits by opponent for a race.
    await career.locator('[data-season-link="2026"]').click();
    const season = page.locator('[data-sport-level="season"]');
    await expect(season.locator('[data-sport-season-totals] [data-stat="pace_s_per_km"]')).toHaveText('4:40', { timeout: 20_000 });
    await expect(season.locator('[data-sport-split]')).toHaveCount(0);
  } finally {
    await ctx.close();
    await api.dispose();
    await deleteQaUser(runner.id);
  }
});
