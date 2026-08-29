import { test, expect } from '@playwright/test';
import {
  apiAs, adminClient, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, readErrorBody,
} from './helpers/qa-user';

// Layered multi-person /calendar (calendar round, PR 3): a guardian's own
// calendar overlays each supervised child's schedule, with person/category
// chip filters (AND across groups, OR within). Fixtures: guardian A + child;
// user B holds a co-guardian seat and organizes the child's event, so from
// A's perspective it is a CHILD-ONLY layer (A is neither organizer nor
// guest). Locators scope to <main> — the off-canvas drawer also carries the
// child's name (guardian-console lesson). afterAll deletes the child.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const HANDLE = `eaqa_layer_${stamp}`;
const CHILD_GAME = `QA layer game ${stamp}`;
const OWN_PRACTICE = `QA layer practice ${stamp}`;
let flagOn = true;
let childId = '';
let childEventId = '';
let ownEventId = '';

test('setup: child + co-guardian B; B organizes the child game; A schedules their own practice', async () => {
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    if (!guardianFlagOn()) {
      flagOn = false;
      test.skip(true, 'guardian flag off in this environment');
      return;
    }
    // Seeded via service role — this spec's subject is the layered view,
    // not the creation route (whose 5/day rate limit is a safety rail).
    childId = await createQaChild(loadQaUser('user.json').id, {
      firstName: 'Junior', lastName: 'Layer', handle: HANDLE,
    });

    const { error } = await adminClient().from('profile_access').insert({
      user_id: loadQaUser('user-b.json').id,
      profile_id: childId,
      role: 'guardian',
      granted_by: loadQaUser('user.json').id,
    });
    expect(error, JSON.stringify(error)).toBeNull();

    const start = new Date(Date.now() + 2 * 86_400_000);
    const game = await apiB.post('/api/calendar/events', {
      data: {
        title: CHILD_GAME,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
        timezone: 'America/New_York',
        category: 'game',
        guests: { profile_ids: [childId] },
      },
    });
    test.skip(game.status() === 404, 'calendar flag off');
    expect(game.ok(), await readErrorBody(game)).toBe(true);
    childEventId = (await game.json()).event?.id;

    const practice = await apiA.post('/api/calendar/events', {
      data: {
        title: OWN_PRACTICE,
        starts_at: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
        ends_at: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
        timezone: 'America/New_York',
        category: 'practice',
      },
    });
    expect(practice.ok(), await readErrorBody(practice)).toBe(true);
    ownEventId = (await practice.json()).event?.id;
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('layered month: child event renders beside own; chips isolate people and categories; detail opens; filters survive reload', async ({ page }) => {
  test.skip(!flagOn || !childEventId || !ownEventId, 'setup skipped');
  await page.goto('/calendar');
  const main = page.locator('main');

  // Both layers present, chip row rendered.
  await expect(main.getByText(CHILD_GAME)).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText(OWN_PRACTICE)).toBeVisible();
  const youChip = main.getByRole('button', { name: 'You', exact: true });
  const juniorChip = main.getByRole('button', { name: 'Junior', exact: true });
  await expect(youChip).toBeVisible();
  await expect(juniorChip).toBeVisible();

  // Person isolation: You-only hides the child-only game.
  await youChip.click();
  await expect(main.getByText(CHILD_GAME)).toHaveCount(0);
  await expect(main.getByText(OWN_PRACTICE)).toBeVisible();

  // Person + category AND: Junior + Games shows just the game.
  await youChip.click(); // clear person
  await juniorChip.click();
  await main.getByRole('button', { name: 'Game', exact: true }).click();
  await expect(main.getByText(CHILD_GAME)).toBeVisible();
  await expect(main.getByText(OWN_PRACTICE)).toHaveCount(0);

  // Selection persists across a reload (localStorage), and Clear resets.
  await page.reload();
  await expect(main.getByText(CHILD_GAME)).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText(OWN_PRACTICE)).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Junior', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await main.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(main.getByText(OWN_PRACTICE)).toBeVisible();

  // Tapping the layered child event opens read-only detail — PR 2's
  // household access; before it this was a 404 dead end.
  await main.getByText(CHILD_GAME).click();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
});

test.afterAll(async () => {
  if (!flagOn || !childId) return;
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    if (ownEventId) await apiA.delete(`/api/calendar/events/${ownEventId}?scope=this`);
    if (childEventId) await apiB.delete(`/api/calendar/events/${childEventId}?scope=this`);
    await deleteQaUser(childId).catch(e => console.error('[e2e] layers cleanup failed:', e));
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('chip row wraps and toggles at phone width @mobile', async ({ page }) => {
  // Self-sufficient (mobile project = separate process): seeds and cleans
  // its own child + child-only event, then drives the chips at 390×844.
  const api = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let mChildId = '';
  let mEventId = '';
  const mHandle = `eaqa_layerm_${stamp}`;
  const mTitle = `QA layer mobile ${stamp}`;
  try {
    test.skip(!guardianFlagOn(), 'guardian flag off in this environment');
    mChildId = await createQaChild(loadQaUser('user.json').id, {
      firstName: 'Nova', lastName: 'Mobile', handle: mHandle, ageYears: 12,
    });
    const { error } = await adminClient().from('profile_access').insert({
      user_id: loadQaUser('user-b.json').id,
      profile_id: mChildId,
      role: 'guardian',
      granted_by: loadQaUser('user.json').id,
    });
    expect(error, JSON.stringify(error)).toBeNull();
    const start = new Date(Date.now() + 2 * 86_400_000);
    const game = await apiB.post('/api/calendar/events', {
      data: {
        title: mTitle,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
        timezone: 'America/New_York',
        category: 'game',
        guests: { profile_ids: [mChildId] },
      },
    });
    test.skip(game.status() === 404, 'calendar flag off');
    expect(game.ok(), await readErrorBody(game)).toBe(true);
    mEventId = (await game.json()).event?.id;

    await page.goto('/calendar');
    const main = page.locator('main');
    // Phone month cells render dot markers, not chips — the agenda list is
    // where titles are text at 390px.
    await main.getByRole('button', { name: 'Agenda' }).click();
    await expect(main.getByText(mTitle)).toBeVisible({ timeout: 20_000 });
    const novaChip = main.getByRole('button', { name: 'Nova', exact: true });
    await expect(novaChip).toBeVisible();
    // Chips must be tappable at phone width: You-only hides the child layer.
    await main.getByRole('button', { name: 'You', exact: true }).click();
    await expect(main.getByText(mTitle)).toHaveCount(0);
    await novaChip.click();
    await expect(main.getByText(mTitle)).toBeVisible();
  } finally {
    if (mEventId) await apiB.delete(`/api/calendar/events/${mEventId}?scope=this`);
    if (mChildId) {
      await deleteQaUser(mChildId).catch(e => console.error('[e2e] layers mobile cleanup failed:', e));
    }
    await apiB.dispose();
    await api.dispose();
  }
});
