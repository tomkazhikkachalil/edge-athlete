import fs from 'fs';
import path from 'path';
import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The three profile buckets (Tom, Oct 4 2026 — see src/lib/statements.ts):
//   MEDIA  = everything that is not a notion (text only): photos, videos AND
//            posts with a data card.
//   STATS  = posts WITH DATA (a round, a shared round, a stat line …). A plain
//            photo post is NEVER a stat, whatever sport the composer stamped
//            on it. Stats ⊂ Media.
// The bug this pins: the Stats hub read tab=all narrowed by sport, so a
// photo post sat in the Stats grid while the Stats badge (the data-posts
// count) disagreed. Now the badge, the grid and the API agree.
//
// Two registrations of one body: the desktop project runs the untagged test,
// the phone projects (Chromium + WebKit) the @mobile one.

async function buckets(browser: Browser) {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const stamp = Date.now().toString(36);
  const created: string[] = [];
  let storageKey: string | null = null;
  // The sport chip needs the athlete to PLAY the sport (a skill card).
  const priorSettings = await admin.from('sport_settings').select('profile_id').eq('profile_id', alpha.id).eq('sport_key', 'ice_hockey').maybeSingle();
  try {
    if (!priorSettings.data) {
      await admin.from('sport_settings').upsert([{ profile_id: alpha.id, sport_key: 'ice_hockey', settings: { competitive_level: 'aaa' } }], { onConflict: 'profile_id,sport_key' });
    }

    // (a) A plain photo post, stamped with the athlete's sport the way the
    // composer does (postType = the declared sport, no stats_data).
    let res = await api.post('/api/posts', { data: { caption: `Just a photo ${stamp}`, visibility: 'public', postType: 'ice_hockey' } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const plainId = (await res.json()).post.id as string;
    created.push(plainId);
    const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
    storageKey = `posts/${alpha.id}/qa-buckets-${stamp}.png`;
    let up = await admin.storage.from('uploads').upload(storageKey, png, { contentType: 'image/png', upsert: true });
    for (let attempt = 1; up.error && attempt < 3; attempt++) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      up = await admin.storage.from('uploads').upload(storageKey, png, { contentType: 'image/png', upsert: true });
    }
    expect(up.error, up.error?.message).toBeNull();
    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/${storageKey}`;
    const mediaRow = await admin.from('post_media').insert({ post_id: plainId, media_url: publicUrl, media_type: 'image', display_order: 1, width: 320, height: 240 });
    expect(mediaRow.error, mediaRow.error?.message).toBeNull();

    // (b) A self-entered stat line — a post WITH data.
    res = await api.post('/api/posts', {
      data: { caption: `Two points ${stamp}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-20', opponent: 'Wolves', result: 'W', stats: { goals: 1, assists: 1 } } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const lineId = (await res.json()).post.id as string;
    created.push(lineId);

    // The API: the sets and the badges agree.
    const counts = (await (await api.post(`/api/profile/${alpha.id}/media`)).json()) as { all: number; stats: number };
    const statsItems = ((await (await api.get(`/api/profile/${alpha.id}/media?tab=stats&limit=100`)).json()).items as { id: string }[]).map(i => i.id);
    const allItems = ((await (await api.get(`/api/profile/${alpha.id}/media?tab=all&limit=100`)).json()).items as { id: string }[]).map(i => i.id);
    expect(statsItems).toContain(lineId);
    expect(statsItems).not.toContain(plainId);
    expect(allItems).toContain(lineId);
    expect(allItems).toContain(plainId);
    if (statsItems.length < 100) expect(counts.stats).toBe(statsItems.length);
    if (allItems.length < 100) expect(counts.all).toBe(allItems.length);

    // The UI, on both profile routes (route parity).
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctx.newPage();
      for (const url of ['/athlete', `/athlete/${alpha.id}`]) {
        await page.goto(url);
        const tabs = page.locator('[aria-label="Profile sections"]').first();
        await expect(tabs).toBeVisible({ timeout: 20_000 });
        // Media: both posts.
        await tabs.locator('[data-tab="all"]').click();
        await expect(page.locator(`[data-post-id="${plainId}"]`).first()).toBeVisible({ timeout: 20_000 });
        await expect(page.locator(`[data-post-id="${lineId}"]`).first()).toBeVisible();
        // Stats: the data post only — under All Sports and under the sport's chip.
        await tabs.locator('[data-tab="stats"]').click();
        const hub = page.getByTestId('stats-hub');
        await expect(hub.locator(`[data-post-id="${lineId}"]`)).toBeVisible({ timeout: 20_000 });
        expect(await hub.locator(`[data-post-id="${plainId}"]`).count()).toBe(0);
        const chips = hub.getByRole('tablist', { name: 'Sport' });
        if (await chips.count()) {
          await chips.getByRole('tab', { name: 'Ice Hockey' }).click();
          await expect(hub.locator(`[data-post-id="${lineId}"]`)).toBeVisible({ timeout: 20_000 });
          expect(await hub.locator(`[data-post-id="${plainId}"]`).count()).toBe(0);
        }
        // The Stats badge is the data-posts count the API gave.
        const badge = (await tabs.locator('[data-tab="stats"]').innerText()).replace(/\D/g, '');
        if (counts.stats <= 99) expect(Number(badge)).toBe(counts.stats);
      }
    } finally {
      await ctx.close();
    }
  } finally {
    for (const id of created) await admin.from('posts').delete().eq('id', id);
    if (storageKey) await admin.storage.from('uploads').remove([storageKey]).catch(() => {});
    if (!priorSettings.data) await admin.from('sport_settings').delete().eq('profile_id', alpha.id).eq('sport_key', 'ice_hockey');
    await api.dispose();
  }
}

test('a photo post is Media only; a post with data is Media and Stats; the badge matches the grid', async ({ browser }) => {
  test.setTimeout(180_000);
  await buckets(browser);
});

test('a photo post is Media only; a post with data is Media and Stats; the badge matches the grid @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  await buckets(browser);
});
