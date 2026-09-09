import { test, expect } from '@playwright/test';
import path from 'node:path';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { closeWindow, openWindow } from './helpers/org-page';

// Org Pages R3: the in-app org page is a glance grid — every dense section
// behind a tappable bubble (one big number + a sub-line) whose "larger
// window" hosts the section unchanged. This spec pins the grid itself:
// faces carry their numbers, a face is genuinely on top (counting is not
// seeing — elementFromPoint resolves inside it), the deep link
// ?window=members opens the sheet at phone width, X and Escape close it,
// and nothing pushes the page wider than 390.

test('@mobile org page glance grid: faces, deep link, sheet, no overflow', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();
  const stamp = Date.now();
  const name = `QA Glance Club ${stamp}`;
  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name, description: 'Glance probe club', owner_profile_id: userA.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { error: me } = await admin.from('memberships').insert([
    { club_id: clubId, profile_id: userA.id, role: 'owner' },
    { club_id: clubId, profile_id: userB.id, role: 'member' },
  ]);
  expect(me, me?.message).toBeNull();

  try {
    // The owner (default storage state) lands on the grid; Members shows 2.
    await page.goto(`/club/${clubId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
    const grid = page.locator('[data-org-glance]');
    await expect(grid).toBeVisible();
    const membersFace = page.locator('[data-org-bubble="members"]');
    await expect(membersFace).toBeVisible();
    await expect(membersFace).toContainText('2');
    await expect(membersFace).toContainText('members');
    // The whole card is the button, and it is really on top.
    await membersFace.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
    const onTop = await membersFace.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop, 'the Members face hit-tests to itself').toBe(true);
    // No dense list on the page until a bubble is tapped.
    await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
    // Optional visual dump (E2E_DUMP_DIR precedent): the grid in both themes,
    // once the late reads have landed and the staggered entrances settled.
    const dump = process.env.E2E_DUMP_DIR;
    if (dump) {
      await page.waitForTimeout(1500);
      await grid.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
      const w = page.viewportSize()?.width ?? 0;
      await page.screenshot({ path: path.join(dump, `org-glance-${w}-light.png`), fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(dump, `org-glance-${w}-dark.png`), fullPage: true });
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      await page.waitForTimeout(200);
    }

    // Tap → the sheet hosts the Members section unchanged (its h2, its rows).
    const win = await openWindow(page, 'members');
    await expect(win.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(win.getByText('Edge Bravo')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Make manager' })).toBeVisible();
    if (dump) await page.screenshot({ path: path.join(dump, `org-glance-window-${page.viewportSize()?.width ?? 0}.png`) });
    await win.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('[data-larger-window]')).toHaveCount(0);

    // Deep link: ?window=members opens the sheet on load; Escape closes it.
    await page.goto(`/club/${clubId}?window=members`);
    await expect(page.locator('[data-larger-window="members"]')).toBeVisible({ timeout: 20_000 });
    await closeWindow(page);

    // Nothing pushes the page wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await admin.from('clubs').delete().eq('id', clubId);
  }
});

test('org page glance grid at desktop width: four columns, a small face takes one', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const admin = adminClient();
  const stamp = Date.now();
  const name = `QA Glance Wide ${stamp}`;
  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name, description: 'Glance probe club', owner_profile_id: userA.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { error: me } = await admin.from('memberships').insert([{ club_id: clubId, profile_id: userA.id, role: 'owner' }]);
  expect(me, me?.message).toBeNull();
  try {
    await page.goto(`/club/${clubId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
    const grid = page.locator('[data-org-glance]');
    const face = page.locator('[data-org-bubble="members"]');
    await expect(face).toBeVisible();
    await face.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
    const [gridBox, faceBox] = await Promise.all([grid.boundingBox(), face.boundingBox()]);
    // lg: four columns — a `sm` face is a quarter of the grid, not a half.
    expect(faceBox!.width).toBeLessThan(gridBox!.width / 3);
    const dump = process.env.E2E_DUMP_DIR;
    if (dump) {
      await page.waitForTimeout(1500);
      await grid.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
      await page.screenshot({ path: path.join(dump, 'org-glance-1280-light.png'), fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(dump, 'org-glance-1280-dark.png'), fullPage: true });
    }
  } finally {
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
