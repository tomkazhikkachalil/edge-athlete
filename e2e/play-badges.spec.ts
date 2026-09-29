import { test, expect, type Browser } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';

// Play program P4 (Sep 28 2026): badges are EARNED from real results — the
// post-write hook on athlete_performances (244) awards them, one
// 'achievement' bell per write, the bell's realtime row throws the confetti
// + toast, and the trophy case shows them on BOTH profile routes (the
// Achievements tab on /athlete/[id], the compact shelf on /u/). Each test
// mints its own athlete (badge state never leaks between specs) and makes
// it public so a second viewer can read /u/. Skips on a target without 244.

// 18 holes of par 4 (72): one birdie, six bogeys → 77 — breaks 100 / 90 / 80, a first birdie.
const HOLES_77 = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, score: i === 0 ? 3 : i <= 6 ? 5 : 4 }));

async function mintAthlete(): Promise<{ user: QaUser; handle: string }> {
  const admin = adminClient();
  const user = await createQaUser({ displayName: 'Badge Golfer', firstName: 'Badge', lastName: 'Golfer' });
  const handle = `edgeqa-${user.id.slice(0, 8)}`;
  const { error } = await admin.from('profiles').update({ handle, visibility: 'public' }).eq('id', user.id);
  expect(error, error?.message).toBeNull();
  return { user, handle };
}

async function contextFor(browser: Browser, user: QaUser, viewport?: { width: number; height: number }) {
  const state = await mintStorageState(user);
  return browser.newContext({ storageState: state, extraHTTPHeaders: bypassHeaders(), ...(viewport ? { viewport } : {}) });
}

async function postRound77(ctx: Awaited<ReturnType<typeof contextFor>>, stamp: number): Promise<void> {
  const res = await ctx.request.post(`${E2E_BASE_URL}/api/posts`, {
    data: {
      caption: `Badge round ${stamp}`,
      visibility: 'public',
      postType: 'golf',
      golfData: { date: '2026-09-20', courseName: `QA Badge Links ${stamp}`, holes: '18', coursePar: 72, holesData: HOLES_77 },
    },
  });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
}

async function awardedKeys(userId: string, expected: string): Promise<string[]> {
  const admin = adminClient();
  for (let i = 0; i < 40; i++) {
    const { data, error } = await admin.from('badge_awards').select('badge_key').eq('profile_id', userId);
    expect(error, error?.message).toBeNull();
    const keys = (data ?? []).map(r => r.badge_key as string);
    if (keys.includes(expected)) return keys;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`badge ${expected} was never awarded`);
}

test.beforeAll(async () => {
  const probe = await adminClient().from('badge_awards').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 244 not applied on this target');
});

test('a round earns badges: one bell, the live celebration, the trophy case, and the public profile', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const { user, handle } = await mintAthlete();
  const ctx = await contextFor(browser, user);
  const visitor = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', extraHTTPHeaders: bypassHeaders() });
  try {
    const page = await ctx.newPage();
    await page.goto('/feed');
    await expect(page.getByRole('banner')).toBeVisible({ timeout: 20_000 });
    // Give the bell's realtime channel a moment to subscribe before the write.
    await page.waitForTimeout(3_000);

    await postRound77(ctx, Date.now());
    const keys = await awardedKeys(user.id, 'golf.break_80');
    expect(keys).toEqual(expect.arrayContaining(['golf.first_result', 'golf.break_100', 'golf.break_90', 'golf.break_80', 'golf.first_birdie']));
    expect(keys).not.toContain('golf.break_70');

    // ONE bell for the whole write, naming the badges.
    const { data: bells } = await admin.from('notifications').select('title, action_url, metadata').eq('user_id', user.id).eq('type', 'achievement');
    expect(bells).toHaveLength(1);
    expect(bells![0].title).toMatch(/badges earned/);
    expect(bells![0].action_url).toBe(`/athlete/${user.id}?tab=achievements`);

    // The live celebration: the realtime row → a toast (the confetti is a canvas garnish).
    await expect(page.getByText(/badges earned/).first()).toBeVisible({ timeout: 25_000 });

    // The trophy case on the owner's profile, and a badge's detail.
    await page.goto(`/athlete/${user.id}?tab=achievements`);
    const shelf = page.locator('[data-badges="full"]');
    await expect(shelf.locator('[data-badge-key="golf.break_80"]')).toBeVisible({ timeout: 20_000 });
    await expect(shelf.getByText('Up next').first(), 'the owner sees what to chase').toBeVisible();
    await shelf.locator('[data-badge-key="golf.break_80"]').click();
    const detail = page.locator('[data-larger-window="badge-detail"]');
    await expect(detail.getByText('Shot 77')).toBeVisible();
    await expect(detail.getByText('From a self-reported result')).toBeVisible();

    // Route parity: a visitor on /u/ sees the compact shelf (no "Up next" — that is the owner's).
    const vpage = await visitor.newPage();
    await vpage.goto(`/u/@${handle}`);
    const compact = vpage.locator('[data-badges="compact"]');
    await expect(compact.getByText('Broke 80')).toBeVisible({ timeout: 20_000 });
    await expect(vpage.getByText('Up next')).toHaveCount(0);
  } finally {
    await ctx.close();
    await visitor.close();
    await deleteQaUser(user.id);
  }
});

test('a private athlete\'s badges are not read by a stranger', async () => {
  test.setTimeout(60_000);
  const admin = adminClient();
  const { user } = await mintAthlete();
  try {
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', user.id);
    await admin.from('badge_awards').insert({ profile_id: user.id, badge_key: 'golf.first_result', sport_key: 'golf', earned_on: '2026-09-20' });
    const stranger = loadQaUser('user-b.json');
    expect(stranger.id).not.toBe(user.id);
    const { request } = await import('@playwright/test');
    const api = await request.newContext({ baseURL: E2E_BASE_URL, storageState: 'e2e/.auth/state-b.json', extraHTTPHeaders: bypassHeaders() });
    const res = await api.get(`/api/profile/${user.id}/badges`);
    expect(res.status()).toBe(200);
    expect((await res.json()).badges).toEqual([]);
    expect(res.headers()['cache-control']).toContain('no-store');
    const anon = await request.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: bypassHeaders(), storageState: { cookies: [], origins: [] } });
    expect((await (await anon.get(`/api/profile/${user.id}/badges`)).json()).badges).toEqual([]);
    await api.dispose();
    await anon.dispose();
  } finally {
    await deleteQaUser(user.id);
  }
});

test('the trophy case at phone width: the tab deep link, the shelf, the bottom-sheet detail @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const { user } = await mintAthlete();
  const ctx = await contextFor(browser, user, { width: 390, height: 844 });
  try {
    await postRound77(ctx, Date.now());
    await awardedKeys(user.id, 'golf.first_birdie');
    const page = await ctx.newPage();
    await page.goto(`/athlete/${user.id}?tab=achievements`);
    const tile = page.locator('[data-badges="full"] [data-badge-key="golf.first_birdie"]');
    await expect(tile).toBeVisible({ timeout: 20_000 });
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    const detail = page.locator('[data-larger-window="badge-detail"]');
    await expect(detail.getByText('Made a birdie.')).toBeVisible();
    await expect(detail).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);
  } finally {
    await ctx.close();
    await deleteQaUser(user.id);
  }
});
