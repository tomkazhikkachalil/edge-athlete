import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports on the profile (profile quick fixes PR 3, Oct 14 2026, mig 263):
// every sport the person has shows — golf no special treatment; pinned
// sports lead, larger; the rest in a compact list; a viewer sees the same
// order with no controls; no sport → nothing, for the owner too (Convention
// 52, Oct 25 2026 — Edit Profile is the door); a disabled registry sport (tennis) shows without a stats door.
// @mobile: 390 px Chromium AND WebKit AND Android.

test.beforeAll(async () => {
  const probe = await adminClient().from('sport_settings').select('pinned').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42703' || probe.error.code === 'PGRST204'), 'migration 263 not applied on this target');
});

test('sports: every sport shows, pins lead, /u/ agrees without controls, no sport → nothing (the pencil is the door) @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Pin Pat', firstName: 'Pin', lastName: 'Pat' });
  // The viewer is a SIGNED-IN second person: production's launch gate sends a
  // signed-out visitor to coming-soon, and the API is public either way.
  const b = await createQaUser({ displayName: 'Viewer Vin', firstName: 'Viewer', lastName: 'Vin' });
  const handle = `pinpat${Math.floor(Math.random() * 1e6)}`;
  await admin.from('profiles').update({ visibility: 'public', handle }).eq('id', a.id);
  const ctx = await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() });
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  try {
    const page = await ctx.newPage();
    // (a) no sport: NOTHING on the profile — for the owner as for a viewer
    // (Convention 52: no "add your …" prompt on the profile; the pencil is
    // the one owner control and Edit Profile's Sports tab is where sports
    // are added). The profile shows no inline editing at all.
    await page.goto('/athlete');
    await expect(page.locator('[data-profile-cover] [data-profile-edit]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#sports')).toHaveCount(0);
    await expect(page.locator('[data-sports-empty]')).toHaveCount(0);
    await expect(page.getByText('No sports yet')).toHaveCount(0);
    await expect(page.getByLabel('X handle')).toHaveCount(0);
    await expect(page.getByText('Add your bio')).toHaveCount(0);
    await expect(page.locator('[data-add-avatar], [data-add-cover]')).toHaveCount(0);
    await expect(page.locator('[data-profile-edit]')).toHaveCount(1);
    await page.locator('[data-profile-cover] [data-profile-edit]').click();
    const dialog = page.getByRole('dialog', { name: 'Edit Profile', exact: true });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await expect(dialog.locator('[data-sports-tab]')).toBeVisible();
    await page.getByRole('button', { name: 'Close modal' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // (b) golf + basketball declared (the onboarding / picker shape): both rows, no pins
    await admin.from('profiles').update({ sport: 'Golf' }).eq('id', a.id);
    const { error: seedErr } = await admin.from('sport_settings').upsert(
      [{ profile_id: a.id, sport_key: 'golf', settings: {} }, { profile_id: a.id, sport_key: 'basketball', settings: {} }],
      { onConflict: 'profile_id,sport_key' }
    );
    expect(seedErr, seedErr?.message).toBeNull();
    await page.goto('/athlete');
    const sports = page.locator('#sports');
    await expect(sports.locator('[data-sport-card="golf"]')).toBeVisible({ timeout: 30_000 });
    await expect(sports.locator('[data-sport-card="basketball"]')).toBeVisible();
    await expect(sports.locator('[data-sports-pinned]')).toHaveCount(0);
    // the compact rows: golf (the primary) first
    const order = await sports.locator('[data-sport-card]').evaluateAll(els => els.map(e => e.getAttribute('data-sport-card')));
    expect(order).toEqual(['golf', 'basketball']);

    // (c) Pin Basketball → first and large; Golf stays a compact row
    await sports.getByRole('button', { name: 'Pin Basketball', exact: true }).click();
    await expect(sports.locator('[data-sports-pinned] [data-sport-card="basketball"]')).toBeVisible({ timeout: 20_000 });
    await expect(sports.getByRole('button', { name: 'Unpin Basketball', exact: true })).toBeVisible();
    await expect(sports.locator('[data-sports-rest] [data-sport-card="golf"]')).toBeVisible();
    await expect(sports.locator('[data-sport-card]').first()).toHaveAttribute('data-sport-card', 'basketball');
    const { data: row } = await admin.from('sport_settings').select('pinned, pin_order').eq('profile_id', a.id).eq('sport_key', 'basketball').single();
    expect(row).toMatchObject({ pinned: true, pin_order: 1 });
    // the stats door keeps its name
    await expect(sports.getByRole('button', { name: 'Basketball stats', exact: true })).toBeVisible();

    // (d) /u/ (CDN-cached 60 s): the same order, no pin controls
    await settleBody(anon, `/api/public/profile?handle=${handle}`, '"pinned":true');
    const pageB = await (await browser.newContext({ storageState: await mintStorageState(b), extraHTTPHeaders: bypassHeaders() })).newPage();
    await pageB.goto(`/u/${handle}`);
    const sportsB = pageB.locator('#sports');
    await expect(sportsB.locator('[data-sport-card]').first()).toHaveAttribute('data-sport-card', 'basketball', { timeout: 30_000 });
    await expect(sportsB.locator('[data-sport-pin]')).toHaveCount(0);
    await expect(sportsB.getByRole('button', { name: /^(Pin|Unpin) /i })).toHaveCount(0);
    await pageB.context().close();

    // (e) a disabled registry sport: tennis shows, with no stats door
    await admin.from('sport_settings').upsert({ profile_id: a.id, sport_key: 'tennis', settings: {} }, { onConflict: 'profile_id,sport_key' });
    await page.goto('/athlete');
    await expect(sports.locator('[data-sport-card="tennis"]')).toBeVisible({ timeout: 30_000 });
    await expect(sports.locator('[data-sport-card="tennis"]').getByText('Stats coming soon')).toBeVisible();
    await expect(sports.getByRole('button', { name: 'Tennis stats', exact: true })).toHaveCount(0);
  } finally {
    await anon.dispose();
    await ctx.close();
    await deleteQaUser(a.id);
    await deleteQaUser(b.id);
  }
});
