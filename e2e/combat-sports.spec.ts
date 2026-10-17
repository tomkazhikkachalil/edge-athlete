import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';

// Combat sports (Oct 16 2026, C1–C3): MMA, boxing, wrestling and jiu-jitsu
// are sports with bout results — W / L / D / NC, how it ended, the round and
// time, the context. The envelope's W / L / T is derived on the server (a
// draw is T, a no contest none); the profile reads the record.

async function ctxFor(u: QaUser): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
}

const post = (api: APIRequestContext, sport: string, bout: unknown, extra: Record<string, unknown> = {}) =>
  api.post('/api/posts', {
    data: { postType: sport, caption: '', visibility: 'private', stats_data: { type: 'stat_line', sport_key: sport, date: '2026-10-10', opponent: 'J. Rivera', stats: {}, bout, ...extra } },
  });

test('bouts save with a derived result; the profile reads 3-1-1 (1 NC) and two finishes; the server refuses what a sport does not allow', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Fighter Fay', firstName: 'Fighter', lastName: 'Fay' });
  const api = await ctxFor(a);
  try {
    const bouts = [
      { result: 'W', method: 'tko', round: 2, time_s: 107, context: { level: 'pro', weight_class: '155 lb', format: { rounds: 3, minutes: 5 } } },
      { result: 'W', method: 'submission', round: 1, time_s: 200 },
      { result: 'W', method: 'decision_unanimous' },
      { result: 'L', method: 'decision_split' },
      { result: 'D', method: 'decision_majority' },
      { result: 'NC' },
    ];
    for (const b of bouts) {
      const r = await post(api, 'mma', b);
      expect(r.status(), await readErrorBody(r)).toBeLessThan(300);
    }
    const { data: rows } = await admin.from('posts').select('stats_data').eq('profile_id', a.id).eq('sport_key', 'mma');
    const results = (rows ?? []).map(r => (r.stats_data as { result?: string }).result ?? 'none').sort();
    expect(results).toEqual(['L', 'T', 'W', 'W', 'W', 'none']);

    const lines = await api.get(`/api/sports/stat-lines?profileId=${a.id}&sport=mma`);
    expect(lines.status(), await readErrorBody(lines)).toBe(200);
    const body = await lines.json();
    const tile = (label: string) => (body.highlights as { label: string; value: string }[]).find(h => h.label === label)?.value;
    expect(tile('Record')).toBe('3-1-1 (1 NC)');
    expect(tile('Finishes')).toBe('2');
    expect(tile('Bouts')).toBe('6');
    expect(JSON.stringify(body)).toContain('W · TKO · R2 1:47 · Pro · 155 lb');

    // The other three sports, each in its own words.
    for (const [sport, bout] of [
      ['bjj', { result: 'W', method: 'submission', context: { gi: 'nogi', belt: 'purple' } }],
      ['wrestling', { result: 'W', method: 'pin', round: 2, time_s: 45, context: { style: 'folkstyle' } }],
      ['boxing', { result: 'L', method: 'decision_unanimous', context: { level: 'pro', format: { rounds: 10, minutes: 3 } } }],
    ] as const) {
      const r = await post(api, sport, bout);
      expect(r.status(), `${sport}: ${await readErrorBody(r)}`).toBeLessThan(300);
    }

    // Refused by name.
    const refusals: [string, unknown, Record<string, unknown>?][] = [
      ['bjj', { result: 'W', method: 'pin' }],
      ['boxing', { result: 'W', method: 'decision_split', round: 10 }],
      ['wrestling', { result: 'W', context: { gi: 'gi' } }],
      ['mma', { result: 'L' }, { result: 'W' }],
      ['running', { result: 'W' }, { stats: { distance_km: 5 } }],
    ];
    for (const [sport, bout, extra] of refusals) {
      const r = await post(api, sport, bout, extra ?? {});
      expect(r.status(), `${sport} ${JSON.stringify(bout)}`).toBe(400);
    }
  } finally {
    await api.dispose();
    await deleteQaUser(a.id);
  }
});

test('the composer logs an MMA win by TKO and the feed card reads its headline @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const stamp = `Bout ${Date.now()}`;
  try {
    await page.goto('/feed');
    await page.getByRole('button', { name: 'Create', exact: true }).first().click();
    await page.locator('[data-create-sport]').click();
    const selector = page.locator('div[class*="z-[60]"]');
    await selector.getByPlaceholder('Search sports...').fill('mma');
    await selector.getByRole('button', { name: /mma/i }).first().click();
    const fields = page.locator('[data-bout-fields="mma"]');
    await expect(fields).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('Share your thoughts...').fill(stamp);
    await fields.locator('[data-bout-result="W"]').click();
    await fields.locator('[data-bout-field="method"] select').selectOption('tko');
    await fields.locator('[data-bout-field="round"] input').fill('2');
    await fields.getByLabel('Minutes', { exact: true }).fill('1');
    await fields.getByLabel('Seconds', { exact: true }).fill('47');
    await fields.locator('[data-bout-field="weight_class"] input').fill('155 lb');
    for (const b of await fields.locator('[data-bout-result]').all()) {
      const box = await b.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Create Post' }).click();
    const headline = page.locator('[data-bout-headline]', { hasText: 'TKO · R2 1:47 · 155 lb' }).first();
    await expect(headline).toBeVisible({ timeout: 30_000 });
    await expect(headline.locator('xpath=..').locator('[data-stat-line-result="W"]')).toBeVisible();
  } finally {
    await admin.from('posts').delete().eq('caption', stamp);
  }
});
