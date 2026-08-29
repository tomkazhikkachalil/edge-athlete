import { test, expect } from '@playwright/test';
import { apiAs, adminClient, loadQaUser, readErrorBody } from './helpers/qa-user';

// Guardian schedule parity (calendar round, PR 2): every guardian of a
// child — and a view-only seat — sees the child's schedule identically,
// including opening event DETAIL (the household branch in detail-server;
// before this round a co-guardian 404'd on any child event they didn't
// organize). Writes stay organizer-only; viewer seats can never act.
// Serial: one child + one event thread through; the child is deleted in
// afterAll (runs even when a test fails — serial mode skips tests, not
// hooks, and an orphaned @minors.invalid shadow user outlives the QA
// sweep otherwise).

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const HANDLE = `eaqa_cal_${stamp}`;
let flagOn = true;
let childId = '';
let eventId = '';

test('setup: child + co-guardian seat + an event the child attends', async () => {
  const apiA = await apiAs('state.json');
  try {
    const probe = await apiA.post('/api/guardian/athletes', { data: {} });
    if (probe.status() === 404) {
      flagOn = false;
      test.skip(true, 'guardian flag off in this environment');
      return;
    }
    expect(probe.status()).toBe(400);

    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15))
      .toISOString().split('T')[0];
    const created = await apiA.post('/api/guardian/athletes', {
      data: { first_name: 'Junior', last_name: 'Parity', dob, handle: HANDLE },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    childId = (await created.json()).profileId;
    expect(childId).toBeTruthy();

    // Seed user B as the co-guardian directly (the invite ceremony has its
    // own e2e; this spec is about what the seat SEES). Cap trigger allows
    // two guardians; the row cascades when the child is deleted.
    const userA = loadQaUser('user.json');
    const userB = loadQaUser('user-b.json');
    const { error } = await adminClient().from('profile_access').insert({
      user_id: userB.id,
      profile_id: childId,
      role: 'guardian',
      granted_by: userA.id,
    });
    expect(error, JSON.stringify(error)).toBeNull();

    // Guardian A schedules for the child — the create-for-child mechanic is
    // a guest row (guests.profile_ids), organizer stays A.
    const start = new Date(Date.now() + 2 * 86_400_000);
    const res = await apiA.post('/api/calendar/events', {
      data: {
        title: `QA parity game ${stamp}`,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
        timezone: 'America/Denver',
        category: 'game',
        guests: { profile_ids: [childId] },
      },
    });
    test.skip(res.status() === 404, 'calendar flag off');
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    eventId = (await res.json()).event?.id;
    expect(eventId).toBeTruthy();
  } finally {
    await apiA.dispose();
  }
});

test('co-guardian B sees the child schedule AND the event detail; writes stay organizer-only', async () => {
  test.skip(!flagOn || !eventId, 'setup skipped');
  const apiB = await apiAs('state-b.json');
  try {
    // List parity: the same full child calendar A sees.
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const list = await apiB.get(
      `/api/calendar/events?from=${from}&to=${to}&targetProfileId=${childId}`
    );
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    const ids = ((await list.json()).events as { id: string }[]).map(e => e.id);
    expect(ids).toContain(eventId);

    // Detail parity: household access, read-only (was a 404 before this round).
    const detail = await apiB.get(`/api/calendar/events/${eventId}`);
    expect(detail.status(), await readErrorBody(detail)).toBe(200);
    const body = await detail.json();
    expect(body.viewer_access).toBe('household');
    expect(body.event?.title).toBe(`QA parity game ${stamp}`);

    // Household can never write: 403 (organizer message), not a silent edit.
    const patch = await apiB.patch(`/api/calendar/events/${eventId}`, {
      data: { scope: 'this', title: 'hijacked' },
    });
    expect(patch.status()).toBe(403);
    const del = await apiB.delete(`/api/calendar/events/${eventId}?scope=this`);
    expect(del.status()).toBe(403);
  } finally {
    await apiB.dispose();
  }
});

test('co-guardian B opens the deep link read-only in the UI', async ({ browser }) => {
  test.skip(!flagOn || !eventId, 'setup skipped');
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const page = await ctxB.newPage();
    await page.goto(`/calendar?event=${eventId}`);
    await expect(page.getByText(`QA parity game ${stamp}`).first()).toBeVisible({ timeout: 15_000 });
    // Read-only: no edit, no RSVP (the guest row is the CHILD's).
    await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Yes', exact: true })).toHaveCount(0);
  } finally {
    await ctxB.close();
  }
});

test('viewer seat: same reads, no writes, and the ICS family feed includes the child', async () => {
  test.skip(!flagOn || !eventId, 'setup skipped');
  // Demote B to a view-only seat in place — one (user, profile) row.
  const { error } = await adminClient()
    .from('profile_access')
    .update({ role: 'viewer' })
    .eq('profile_id', childId)
    .eq('user_id', loadQaUser('user-b.json').id);
  expect(error, JSON.stringify(error)).toBeNull();

  const apiB = await apiAs('state-b.json');
  try {
    // Detail read survives the demotion.
    const detail = await apiB.get(`/api/calendar/events/${eventId}`);
    expect(detail.status(), await readErrorBody(detail)).toBe(200);
    expect((await detail.json()).viewer_access).toBe('household');

    // Respond-on-behalf stays guardian-only (viewer 403 is the intended gate).
    const respond = await apiB.post(`/api/calendar/events/${eventId}/respond`, {
      data: { status: 'accepted', scope: 'this', targetProfileId: childId },
    });
    expect(respond.status()).toBe(403);

    // ICS feed parity: the viewer's feed carries the child-prefixed VEVENT.
    const mint = await apiB.post('/api/calendar/feed-token', { data: {} });
    expect(mint.ok(), await readErrorBody(mint)).toBe(true);
    const token = ((await mint.json()).url as string).split('/').pop();
    const feed = await apiB.get(`/api/calendar/feed/${token}`);
    expect(feed.ok(), await readErrorBody(feed)).toBe(true);
    const ics = await feed.text();
    expect(ics).toContain(`Junior: QA parity game ${stamp}`);
  } finally {
    await apiB.dispose();
  }
});

test.afterAll(async () => {
  if (!flagOn || !childId) return;
  const apiA = await apiAs('state.json');
  try {
    if (eventId) await apiA.delete(`/api/calendar/events/${eventId}?scope=this`);
    const res = await apiA.delete(`/api/guardian/athletes/${childId}`, {
      data: { confirmHandle: HANDLE },
    });
    if (!res.ok()) {
      console.error('[e2e] parity cleanup failed:', await readErrorBody(res));
    }
  } finally {
    await apiA.dispose();
  }
});

test('the create form offers "Who is this for?" and places the child on the event @mobile', async ({ page }) => {
  // Self-sufficient (mobile project = separate process): seeds and cleans
  // its own child, drives the REAL form at 390×844, then asserts the guest
  // row server-side.
  const api = await apiAs('state.json');
  let mobileChildId = '';
  let mobileEventId = '';
  const mobileHandle = `eaqa_calm_${stamp}`;
  try {
    const probe = await api.post('/api/guardian/athletes', { data: {} });
    test.skip(probe.status() === 404, 'guardian flag off in this environment');
    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 11, 2, 3))
      .toISOString().split('T')[0];
    const created = await api.post('/api/guardian/athletes', {
      data: { first_name: 'Kiddo', last_name: 'Mobile', dob, handle: mobileHandle },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    mobileChildId = (await created.json()).profileId;

    await page.goto('/calendar');
    await page.getByRole('button', { name: /^New( event)?$/ }).click();
    await page.getByLabel('Title').fill(`QA for-child ${stamp}`);
    // Scope to the form: the always-mounted off-canvas drawer ALSO carries
    // the child's name (guardian-console lesson), and Playwright counts its
    // translated-off-screen buttons as "visible". Wait for the row label
    // first — the roster route computes per-athlete summaries and can take
    // seconds.
    await expect(page.getByText('Who is this for?')).toBeVisible({ timeout: 20_000 });
    const chip = page.locator('form').getByRole('button', { name: 'Kiddo' });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(
      page.getByText('Adds them as a guest — every guardian sees it on their schedule.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText('Event created')).toBeVisible({ timeout: 10_000 });

    // Server-side truth: the child holds a guest row on the new event.
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const list = await api.get(`/api/calendar/events?from=${from}&to=${to}`);
    const mine = ((await list.json()).events as { id: string; title: string }[])
      .find(e => e.title === `QA for-child ${stamp}`);
    expect(mine).toBeTruthy();
    mobileEventId = mine!.id;
    const detail = await api.get(`/api/calendar/events/${mobileEventId}`);
    const guests = (await detail.json()).event?.guests as { profile_id: string | null }[];
    expect(guests.some(g => g.profile_id === mobileChildId)).toBe(true);
  } finally {
    if (mobileEventId) await api.delete(`/api/calendar/events/${mobileEventId}?scope=this`);
    if (mobileChildId) {
      await api.delete(`/api/guardian/athletes/${mobileChildId}`, {
        data: { confirmHandle: mobileHandle },
      });
    }
    await api.dispose();
  }
});
