import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program — the bells with an action row. B accepts A's invitation
 * from the notifications page and lands as Playing; A accepts B's request
 * to join a request-mode event from the same row; a decided bell reads
 * what you did and its row is gone. Tagged @mobile: the row's buttons are
 * 44px targets at 390px on Chromium and WebKit.
 */
test('notifications: accept an invitation and a join request from the action row @mobile', async ({ page, browser }) => {

  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const ids: string[] = [];
  try {
    // An invitation to B.
    const created = await apiA.post('/api/sport-events', { data: { name: `QA Bell Invite ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Bell Links', holes: 18 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const inviteEvent = ((await created.json()) as { event: { id: string } }).event.id;
    ids.push(inviteEvent);
    expect((await apiA.post(`/api/sport-events/${inviteEvent}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);

    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/app/notifications');
      // Scope to THIS event's card: the QA users are shared across specs and
      // other specs leave their own pending invitations behind.
      const card = pageB.locator('[data-notification-card][data-notification-type="sport_event_invite"]').filter({ hasText: `QA Bell Invite ${stamp}` }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText(`Edge Alpha invited you to QA Bell Invite ${stamp}`)).toBeVisible();
      await card.locator('[data-notification-accept]').click();
      await expect(card.getByText(`You accepted the invitation to QA Bell Invite ${stamp}`)).toBeVisible({ timeout: 15_000 });
      await expect(card.locator('[data-notification-action-row]')).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
    const view = (await (await apiA.get(`/api/sport-events/${inviteEvent}`)).json()) as { participants: Array<{ profile_id: string; status: string }> };
    expect(view.participants.find(p => p.profile_id === userB.id)?.status).toBe('accepted');

    // A request-mode event: B asks, A accepts from the bell.
    const open = await apiA.post('/api/sport-events', { data: { name: `QA Bell Request ${stamp}`, visibility: 'public', join_mode: 'request', publish: true, round: { scheduled_on: '2030-06-02', course_name: 'QA Bell Links', holes: 18 } } });
    expect(open.status(), await readErrorBody(open)).toBe(201);
    const requestEvent = ((await open.json()) as { event: { id: string } }).event.id;
    ids.push(requestEvent);
    const asked = await apiB.post(`/api/sport-events/${requestEvent}/participants/request`);
    expect(asked.ok(), await readErrorBody(asked)).toBe(true);

    await page.goto('/app/notifications');
    const reqCard = page.locator('[data-notification-card][data-notification-type="sport_event_request"]').filter({ hasText: `QA Bell Request ${stamp}` }).first();
    await expect(reqCard).toBeVisible({ timeout: 20_000 });
    await reqCard.locator('[data-notification-accept]').click();
    await expect(reqCard.getByText(`You accepted Edge Bravo's request to join QA Bell Request ${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(reqCard.locator('[data-notification-action-row]')).toHaveCount(0);
    const view2 = (await (await apiA.get(`/api/sport-events/${requestEvent}`)).json()) as { participants: Array<{ profile_id: string; status: string }> };
    expect(view2.participants.find(p => p.profile_id === userB.id)?.status).toBe('accepted');
  } finally {
    for (const id of ids) {
      await apiA.post(`/api/sport-events/${id}/transition`, { data: { to: 'cancelled' } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${id}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});

/**
 * Phase 3 (PR 12, migration 213) — the match bells. A hosts a singles
 * match and draws A vs B: B's "You play Edge Alpha in …" bell (kind set)
 * renders on the notifications page and lands on the round's Matches
 * tab; a re-save of the same draw bells nobody; B concedes the match and
 * the round completes: B reads "Edge Alpha beat you · conceded" (kind
 * lost), A — the organizer who also plays — "You beat Edge Bravo · conceded"
 * (kind won) beside their own `set` bell. Self-skips before
 * 213 (a probe insert on the type) and before 212.
 */
test('notifications: the match bells — set on the draw, won / lost at completion @mobile', async ({ browser }) => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const admin = adminClient();
  const probe212 = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe212.error, 'sport_event_matches missing — run migration 212');
  const probe = await admin.from('notifications').insert({ user_id: userA.id, type: 'sport_event_match', title: 'probe', message: null, action_url: '/feed', is_read: true, metadata: { probe: stamp } }).select('id').maybeSingle();
  test.skip(!!probe.error, 'sport_event_match is not in the notifications type CHECK — run migration 213');
  if (probe.data?.id) await admin.from('notifications').delete().eq('id', probe.data.id);
  let eventId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', { data: { name: `QA Bell Match ${stamp}`, visibility: 'private', publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Bell Links', holes: 9 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const view = (await created.json()) as { event: { id: string }; rounds: Array<{ id: string }> };
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    expect((await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as { viewer: { participant_id: string }; participants: Array<{ id: string; role: string }> };
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);
    const host = asB.participants.find(p => p.role === 'organizer')!;
    const draw = { groups: [{ members: [host.id, asB.viewer.participant_id] }] };
    expect((await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: draw })).ok()).toBe(true);
    expect((await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: draw })).ok()).toBe(true); // a re-save bells nobody
    const bellsB = await admin.from('notifications').select('id, title, action_url, metadata').eq('user_id', userB.id).eq('type', 'sport_event_match').ilike('action_url', `%${eventId}%`);
    expect(bellsB.data).toHaveLength(1);
    expect(bellsB.data![0]).toMatchObject({ title: `You play Edge Alpha in QA Bell Match ${stamp}`, action_url: `/events/${eventId}?tab=matches&round=${roundId}`, metadata: expect.objectContaining({ kind: 'set' }) });

    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/app/notifications');
      const card = pageB.locator('[data-notification-card][data-notification-type="sport_event_match"]').filter({ hasText: `QA Bell Match ${stamp}` }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText(`You play Edge Alpha in QA Bell Match ${stamp}`)).toBeVisible();
    } finally {
      await ctxB.close();
    }

    // The round starts; B concedes the match; the round completes → won / lost.
    const live = await apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    const matchId = ((await (await apiA.get(`/api/sport-events/${eventId}/matches`)).json()) as { matches: Array<{ id: string }> }).matches[0].id;
    const conceded = await apiB.post(`/api/sport-events/${eventId}/matches/${matchId}/concede`, { data: { hole: null, side: 2, version: 0 } });
    expect(conceded.status(), await readErrorBody(conceded)).toBe(200);
    const done = await apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'completed' } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);
    const lost = await admin.from('notifications').select('title, metadata').eq('user_id', userB.id).eq('type', 'sport_event_match').ilike('action_url', `%${eventId}%`).order('created_at', { ascending: false }).limit(1).maybeSingle();
    expect(lost.data).toMatchObject({ title: `Edge Alpha beat you · conceded in QA Bell Match ${stamp}`, metadata: expect.objectContaining({ kind: 'lost' }) });
    // A is the organizer AND a player: two bells (`set` on the draw, `won` at completion) — read the latest, and assert the first too.
    const bellsA = await admin.from('notifications').select('title, metadata').eq('user_id', userA.id).eq('type', 'sport_event_match').ilike('action_url', `%${eventId}%`).order('created_at', { ascending: false });
    expect(bellsA.data).toHaveLength(2);
    expect(bellsA.data![1]).toMatchObject({ title: `You play Edge Bravo in QA Bell Match ${stamp}`, metadata: expect.objectContaining({ kind: 'set' }) });
    const won = { data: bellsA.data![0] };
    expect(won.data).toMatchObject({ title: `You beat Edge Bravo · conceded in QA Bell Match ${stamp}`, metadata: expect.objectContaining({ kind: 'won' }) });
  } finally {
    if (eventId) await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
    await apiA.dispose();
    await apiB.dispose();
  }
});
