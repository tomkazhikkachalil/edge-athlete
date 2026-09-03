import { test, expect, type Page } from '@playwright/test';
import {
  apiAs, adminClient, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, readErrorBody,
} from './helpers/qa-user';

// The feed sidebar calendar (quick-fixes round, Sep 2026): Upcoming | Month
// behind a segmented control, and a filter row that shows only what applies
// to the viewer — person chips for a household, category chips for the
// categories present, "Needs reply" while an invite is pending. Fixtures
// mirror calendar-layers: guardian A + child; B (co-guardian) organizes the
// child's game (a CHILD-ONLY layer from A's view); A schedules a practice;
// B invites A to a social — A's pending invite. Also pins the feed tab-strip
// gap. afterAll deletes the child and the events.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const HANDLE = `eaqa_sidecal_${stamp}`;
const CHILD_GAME = `QA sidebar game ${stamp}`;
const OWN_PRACTICE = `QA sidebar practice ${stamp}`;
const INVITE = `QA sidebar social ${stamp}`;
let flagOn = true;
let childId = '';
let childEventId = '';
let ownEventId = '';
let inviteEventId = '';
const start = new Date(Date.now() + 2 * 86_400_000);

async function createEvent(
  api: Awaited<ReturnType<typeof apiAs>>,
  data: Record<string, unknown>
): Promise<string> {
  const res = await api.post('/api/calendar/events', { data });
  test.skip(res.status() === 404, 'calendar flag off');
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()).event?.id;
}

test('setup: child + co-guardian B; child game, own practice, pending invite', async () => {
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    if (!guardianFlagOn()) {
      flagOn = false;
      test.skip(true, 'guardian flag off in this environment');
      return;
    }
    childId = await createQaChild(loadQaUser('user.json').id, {
      firstName: 'Junior', lastName: 'Sidebar', handle: HANDLE,
    });
    const { error } = await adminClient().from('profile_access').insert({
      user_id: loadQaUser('user-b.json').id,
      profile_id: childId,
      role: 'guardian',
      granted_by: loadQaUser('user.json').id,
    });
    expect(error, JSON.stringify(error)).toBeNull();

    childEventId = await createEvent(apiB, {
      title: CHILD_GAME,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
      timezone: 'America/New_York',
      category: 'game',
      guests: { profile_ids: [childId] },
    });
    ownEventId = await createEvent(apiA, {
      title: OWN_PRACTICE,
      starts_at: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
      ends_at: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
      timezone: 'America/New_York',
      category: 'practice',
    });
    inviteEventId = await createEvent(apiB, {
      title: INVITE,
      starts_at: new Date(start.getTime() + 4 * 3_600_000).toISOString(),
      ends_at: new Date(start.getTime() + 5 * 3_600_000).toISOString(),
      timezone: 'America/New_York',
      category: 'social',
      guests: { profile_ids: [loadQaUser('user.json').id] },
    });
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

/** The in-month cell for `day` in the widget's Month grid (see the number-
 *  duplication note: low numbers can only repeat in the trailing row, high
 *  numbers only in the leading row). */
function monthCell(page: Page, day: Date) {
  const cells = page.getByTestId('feed-calendar-month').getByRole('button', { name: String(day.getDate()), exact: true });
  return day.getDate() <= 15 ? cells.first() : cells.last();
}

async function openMonthFor(page: Page, day: Date) {
  const widget = page.getByTestId('feed-calendar');
  await widget.getByRole('tab', { name: 'Month' }).click();
  await expect(page.getByTestId('feed-calendar-month')).toBeVisible();
  const now = new Date();
  if (day.getMonth() !== now.getMonth() || day.getFullYear() !== now.getFullYear()) {
    await widget.getByRole('button', { name: 'Next month' }).click();
  }
}

test('feed: tab-strip gap; sidebar Upcoming with viewer-relevant chips; Month day tap; persistence', async ({ page }) => {
  test.skip(!flagOn || !childEventId || !ownEventId || !inviteEventId, 'setup skipped');
  await page.goto('/feed');

  // Fix 1: breathing room between the scope tabs and the first feed item.
  const tabs = page.getByRole('tablist', { name: 'Feed scope' });
  await expect(tabs).toBeVisible();
  const gap = await tabs.evaluate(el => {
    const next = el.nextElementSibling as HTMLElement | null;
    return next ? next.getBoundingClientRect().top - el.getBoundingClientRect().bottom : -1;
  });
  expect(gap).toBeGreaterThanOrEqual(16);

  const widget = page.getByTestId('feed-calendar');
  await widget.scrollIntoViewIfNeeded();
  await expect(widget.getByRole('tab', { name: 'Upcoming' })).toHaveAttribute('aria-selected', 'true');
  await expect(widget.getByText(CHILD_GAME)).toBeVisible({ timeout: 20_000 });
  await expect(widget.getByText(OWN_PRACTICE)).toBeVisible();
  await expect(widget.getByText(INVITE)).toBeVisible();

  // Chips: household people, only the categories present, needs-reply.
  const filters = widget.getByTestId('feed-calendar-filters');
  const youChip = filters.getByRole('button', { name: 'You', exact: true });
  const juniorChip = filters.getByRole('button', { name: 'Junior', exact: true });
  const gameChip = filters.getByRole('button', { name: 'Game', exact: true });
  const replyChip = filters.getByRole('button', { name: 'Needs reply', exact: true });
  await expect(youChip).toBeVisible();
  await expect(juniorChip).toBeVisible();
  await expect(gameChip).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Practice', exact: true })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Social', exact: true })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Tournament', exact: true })).toHaveCount(0);
  await expect(replyChip).toBeVisible();

  // You-only hides the child-only game; the invite is A's own layer.
  await youChip.click();
  await expect(widget.getByText(CHILD_GAME)).toHaveCount(0);
  await expect(widget.getByText(OWN_PRACTICE)).toBeVisible();
  await expect(widget.getByText(INVITE)).toBeVisible();
  await youChip.click();

  // Needs reply narrows to pending invites — A's own social AND the child's
  // game (a child-only layer carries the CHILD's unanswered status, the
  // household item a guardian answers for them); the practice drops out.
  await replyChip.click();
  await expect(widget.getByText(INVITE)).toBeVisible();
  await expect(widget.getByText(CHILD_GAME)).toBeVisible();
  await expect(widget.getByText(OWN_PRACTICE)).toHaveCount(0);
  await filters.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(widget.getByText(OWN_PRACTICE)).toBeVisible();

  // Person + category AND: Junior + Game shows just the game; survives reload.
  await juniorChip.click();
  await gameChip.click();
  await expect(widget.getByText(CHILD_GAME)).toBeVisible();
  await expect(widget.getByText(OWN_PRACTICE)).toHaveCount(0);
  await page.reload();
  await widget.scrollIntoViewIfNeeded();
  await expect(widget.getByText(CHILD_GAME)).toBeVisible({ timeout: 20_000 });
  await expect(widget.getByText(OWN_PRACTICE)).toHaveCount(0);
  await expect(juniorChip).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(widget.getByText(OWN_PRACTICE)).toBeVisible();

  // Month: the grid is fully shown (no expand step); tapping the event's day
  // lists it; the view choice persists; the layered child event opens the
  // read-only detail (household access).
  await openMonthFor(page, start);
  await monthCell(page, start).click();
  await expect(widget.getByText(CHILD_GAME)).toBeVisible();
  await expect(widget.getByText(OWN_PRACTICE)).toBeVisible();
  await page.reload();
  await widget.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('feed-calendar-month')).toBeVisible({ timeout: 20_000 });
  await expect(widget.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
  if (start.getMonth() !== new Date().getMonth()) {
    await widget.getByRole('button', { name: 'Next month' }).click();
  }
  await monthCell(page, start).click();
  await widget.getByText(CHILD_GAME).click();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  // Leave the widget on Upcoming for the next viewer of these fixtures.
  await widget.getByRole('tab', { name: 'Upcoming' }).click();
});

test.afterAll(async () => {
  if (!flagOn || !childId) return;
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    if (ownEventId) await apiA.delete(`/api/calendar/events/${ownEventId}?scope=this`);
    if (childEventId) await apiB.delete(`/api/calendar/events/${childEventId}?scope=this`);
    if (inviteEventId) await apiB.delete(`/api/calendar/events/${inviteEventId}?scope=this`);
    await deleteQaUser(childId).catch(e => console.error('[e2e] sidebar cleanup failed:', e));
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('sidebar calendar at phone width: reachable, chips wrap, Month grid fits @mobile', async ({ page }) => {
  // Self-sufficient (mobile project = separate process): a solo viewer with
  // two categories — no person chips, category chips only for those two.
  const api = await apiAs('state.json');
  const ids: string[] = [];
  const mStamp = `${stamp}m`;
  const practice = `QA sidebar mobile practice ${mStamp}`;
  const game = `QA sidebar mobile game ${mStamp}`;
  try {
    const at = new Date(Date.now() + 3 * 86_400_000);
    ids.push(await createEvent(api, {
      title: practice,
      starts_at: at.toISOString(),
      ends_at: new Date(at.getTime() + 3_600_000).toISOString(),
      timezone: 'America/New_York',
      category: 'practice',
    }));
    ids.push(await createEvent(api, {
      title: game,
      starts_at: new Date(at.getTime() + 2 * 3_600_000).toISOString(),
      ends_at: new Date(at.getTime() + 3 * 3_600_000).toISOString(),
      timezone: 'America/New_York',
      category: 'game',
    }));

    await page.goto('/feed');
    const widget = page.getByTestId('feed-calendar');
    await widget.scrollIntoViewIfNeeded();
    await expect(widget.getByText(practice)).toBeVisible({ timeout: 20_000 });
    const filters = widget.getByTestId('feed-calendar-filters');
    await expect(filters.getByRole('button', { name: 'Practice', exact: true })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'Game', exact: true })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'You', exact: true })).toHaveCount(0);

    await filters.getByRole('button', { name: 'Game', exact: true }).click();
    await expect(widget.getByText(game)).toBeVisible();
    await expect(widget.getByText(practice)).toHaveCount(0);
    await filters.getByRole('button', { name: 'Clear', exact: true }).click();

    await openMonthFor(page, at);
    await monthCell(page, at).click();
    await expect(widget.getByText(practice)).toBeVisible();
    // Nothing pushes the page wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await widget.getByRole('tab', { name: 'Upcoming' }).click();
  } finally {
    for (const id of ids) if (id) await api.delete(`/api/calendar/events/${id}?scope=this`);
    await api.dispose();
  }
});
