import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Phase 7 C5 — the golf-first console. A golf club's console (clubs.primary_sport
// = 'golf', 174) is a site builder first: Website, then Venues & courses,
// then "Leagues & events" (the competitions section, renamed, its create form
// defaulting to a golf leaderboard), then the roster and the rest; the
// checklist is the golf one. A club without a sport keeps the classic
// console (Roster first, the phase-1 checklist). Both at 390px.

const stamp = Math.random().toString(36).slice(2, 8);

test('golf club console: Website → Venues → Leagues & events first, golf checklist, golf leaderboard defaults; classic club unchanged; 390px', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const probe = await admin.from('clubs').select('primary_sport').limit(1);
  test.skip(!!probe.error, `clubs.primary_sport missing — run migration 174 (${probe.error?.message})`);

  const { data: golfClub } = await admin
    .from('clubs')
    .insert({ name: `QA Golf Console ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const { data: plainClub } = await admin
    .from('clubs')
    .insert({ name: `QA Classic Console ${stamp}`, owner_profile_id: owner.id })
    .select('id')
    .single();
  const golfId = golfClub!.id as string;
  const plainId = plainClub!.id as string;
  // The create form needs a season to hang a competition off.
  await admin.from('seasons').insert([
    { club_id: golfId, label: `2026 ${stamp}` },
    { club_id: plainId, label: `2026 ${stamp}` },
  ]);
  await admin.from('memberships').insert([
    { club_id: golfId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: plainId, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);

  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const checklist = () => page.locator('section[aria-label="Get set up"]');
  const sectionOrder = () =>
    page
      .locator('main > section[aria-label]')
      .evaluateAll(els => els.map(e => e.getAttribute('aria-label')).filter(l => l !== 'Get set up'));
  try {
    // The golf club.
    await page.goto(`/app/org/club/${golfId}`);
    await expect(page.getByRole('heading', { name: 'Website', level: 2 })).toBeVisible({ timeout: 20_000 });
    const golfOrder = await sectionOrder();
    expect(golfOrder.slice(0, 3)).toEqual(['Website', 'Venues and courses', 'Competitions']);
    await expect(page.getByRole('heading', { name: 'Leagues & events', level: 2 })).toBeVisible();
    await expect(checklist().getByText('Create your site', { exact: true })).toBeVisible();
    await expect(checklist().getByText('Add your home course (optional)')).toBeVisible();
    await expect(checklist().getByText('Create your first league')).toBeVisible();
    await expect(checklist().getByText('Create a season with dates')).toHaveCount(0);
    await expect(page.getByLabel('Competition sport')).toHaveValue('golf');
    await expect(page.getByLabel('Competition format')).toHaveValue('leaderboard');
    // The checklist's anchors land on the (now id'd) sections.
    expect(await page.locator('section#website').count()).toBe(1);
    expect(await page.locator('section#competitions').count()).toBe(1);
    const golfScroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(golfScroll, 'golf console: no horizontal overflow at 390px').toBeLessThanOrEqual(390);

    // The classic club.
    await page.goto(`/app/org/club/${plainId}`);
    await expect(page.getByRole('heading', { name: 'Roster', level: 2 })).toBeVisible({ timeout: 20_000 });
    const plainOrder = await sectionOrder();
    // Phase 9 V1: Membership sits right after Roster on a club.
    expect(plainOrder.slice(0, 3)).toEqual(['Roster', 'Membership', 'Seasons and divisions']);
    await expect(page.getByRole('heading', { name: 'Competitions', level: 2 })).toBeVisible();
    await expect(checklist().getByText('Create a season with dates')).toBeVisible();
    await expect(checklist().getByText('Create your site', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Competition sport')).toHaveValue('ice_hockey');
    await expect(page.getByLabel('Competition format')).toHaveValue('fixture');
    const plainScroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(plainScroll, 'classic console: no horizontal overflow at 390px').toBeLessThanOrEqual(390);
  } finally {
    await ctx.close();
    await admin.from('clubs').delete().in('id', [golfId, plainId]);
  }
});
