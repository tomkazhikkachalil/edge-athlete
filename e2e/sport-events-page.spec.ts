import { test, expect } from '@playwright/test';
import { apiAs, E2E_BASE_URL, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program — the event PLACE at /events/[id]. B is invited to A's
 * private draft and accepts from the players tab (the notification's deep
 * link); A publishes from the organizer controls; a stranger gets the
 * not-available screen with a way back; a public event is server-rendered
 * with a title for a signed-out reader. Tagged @mobile: every control is
 * reachable at 390px on Chromium and WebKit.
 */
const ANON = 'e2e/.auth/anon.json';

test('event page: invite → accept on the players tab, publish, the stranger screen, public SSR @mobile', async ({ page, browser, request }) => {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const ids: string[] = [];
  try {
    const created = await apiA.post('/api/sport-events', {
      data: { name: `QA Place ${stamp}`, visibility: 'private', round: { scheduled_on: '2030-06-01', course_name: 'QA Place Links', holes: 18 } },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const eventId = ((await created.json()) as { event: { id: string } }).event.id;
    ids.push(eventId);
    const invited = await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } });
    expect(invited.ok(), await readErrorBody(invited)).toBe(true);

    // B lands on the players tab from the bell's deep link and accepts.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/events/${eventId}?tab=players`);
      await expect(pageB.getByRole('heading', { name: `QA Place ${stamp}` })).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
      await pageB.locator('[data-event-join="respond"]').first().getByRole('button', { name: 'Accept' }).click();
      await expect(pageB.locator('[data-event-join="in"]').first()).toBeVisible({ timeout: 15_000 });
      await expect(pageB.locator('[data-event-player="' + userB.id + '"][data-event-player-status="accepted"]')).toBeVisible();
      // The leaderboard tab is reachable and honest before go-live.
      await pageB.getByRole('tab', { name: 'Leaderboard' }).click();
      await expect(pageB.locator('[data-event-leaderboard]')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText('The board fills in once the event is live.')).toBeVisible();
      await expect(pageB).toHaveURL(/tab=leaderboard/);
    } finally {
      await ctxB.close();
    }

    // A publishes from the organizer controls.
    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole('heading', { name: `QA Place ${stamp}` })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-event-status-chip]')).toHaveText(/Draft/);
    await page.locator('[data-event-action="open"]').click();
    await expect(page.locator('[data-event-status-chip]')).toHaveText(/Open/, { timeout: 15_000 });
    await expect(page.locator('[data-event-join="manage"]').first()).toBeVisible();
    await expect(page.getByText('2 playing')).toBeVisible();

    // A stranger gets a real screen with a way back — never a redirect into nowhere.
    const anonCtx = await browser.newContext({ storageState: ANON });
    try {
      const anonPage = await anonCtx.newPage();
      await anonPage.goto(`/events/${eventId}`);
      await expect(anonPage.locator('[data-event-unavailable]')).toBeVisible({ timeout: 15_000 });
      await expect(anonPage.locator('[data-event-unavailable]').getByRole('link', { name: 'Log in' })).toBeVisible();
    } finally {
      await anonCtx.close();
    }

    // A public event is server-rendered for a signed-out reader.
    const pub = await apiA.post('/api/sport-events', {
      data: { name: `QA Public Place ${stamp}`, visibility: 'public', publish: true, round: { scheduled_on: '2030-06-02', course_name: 'QA Public Links', holes: 9 } },
    });
    expect(pub.status(), await readErrorBody(pub)).toBe(201);
    const pubId = ((await pub.json()) as { event: { id: string } }).event.id;
    ids.push(pubId);
    const html = await (await request.get(`${E2E_BASE_URL}/events/${pubId}`, { headers: { cookie: '' } })).text();
    expect(html).toContain('data-event-access="public"');
    expect(html).toContain(`QA Public Place ${stamp}`);
    expect(html).toContain(`<title>QA Public Place ${stamp} — Edge Athlete`);
  } finally {
    for (const id of ids) {
      await apiA.post(`/api/sport-events/${id}/transition`, { data: { to: 'cancelled' } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${id}`).catch(() => null);
    }
    await apiA.dispose();
  }
});
