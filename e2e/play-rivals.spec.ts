import { test, expect, request as pwRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';
import { cleanupEvent } from './helpers/sport-events';

// Play program P6 (Sep 28 2026): a rivalry is one self-join on the fact
// table's shared-game key (244 / P2). Two fresh athletes play a real event
// round (live → scored → completed → the mirror writes both rows keyed on
// the round's group post); the athlete sees the rival with a Show toggle
// (none shown by default), the opponent sees only THEIR OWN record, a
// stranger nothing — until the athlete shows it. Tom: "The user can choose
// what they want to display. It should be displayed in the stats area
// under the sport itself." Fresh users so no other spec's rounds count.

const SIGNED_OUT = { cookies: [], origins: [] };

interface Pair { a: QaUser; b: QaUser; handleA: string; apiA: APIRequestContext; apiB: APIRequestContext; anon: APIRequestContext; eventId: string | null }

async function mintPair(): Promise<Pair> {
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Rival Ace', firstName: 'Rival', lastName: 'Ace' });
  const b = await createQaUser({ displayName: 'Rival Bogey', firstName: 'Rival', lastName: 'Bogey' });
  const handleA = `edgeqa-${a.id.slice(0, 8)}`;
  await admin.from('profiles').update({ handle: handleA, visibility: 'public', sport: 'Golf' }).eq('id', a.id);
  await admin.from('profiles').update({ handle: `edgeqa-${b.id.slice(0, 8)}`, visibility: 'public', sport: 'Golf' }).eq('id', b.id);
  const ctx = (state: Awaited<ReturnType<typeof mintStorageState>>) => pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: state, extraHTTPHeaders: bypassHeaders() });
  return {
    a, b, handleA,
    apiA: await ctx(await mintStorageState(a)),
    apiB: await ctx(await mintStorageState(b)),
    anon: await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: SIGNED_OUT, extraHTTPHeaders: bypassHeaders() }),
    eventId: null,
  };
}

/** A beats B by one over two holes of a nine: A 4, 4 — B 5, 4. */
async function playRound(p: Pair): Promise<string> {
  const stamp = Date.now();
  const created = await p.apiA.post('/api/sport-events', {
    data: { name: `QA Rivals ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: `QA Rival Links ${stamp}`, holes: 9, starting_hole: 1 } },
  });
  expect(created.status(), await readErrorBody(created)).toBe(201);
  const view = await created.json();
  p.eventId = view.event.id as string;
  expect((await p.apiA.post(`/api/sport-events/${p.eventId}/participants`, { data: { profile_ids: [p.b.id] } })).ok()).toBe(true);
  const asB = await (await p.apiB.get(`/api/sport-events/${p.eventId}`)).json();
  expect((await p.apiB.post(`/api/sport-events/${p.eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);
  const live = await p.apiA.post(`/api/sport-events/${p.eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
  expect(live.ok(), await readErrorBody(live)).toBe(true);
  const gp = (await live.json()).rounds[0].group_post_id as string;
  const card = await (await p.apiA.get(`/api/group-posts/${gp}/scorecard`)).json();
  const rowOf = (id: string) => card.scorecard.participants.find((x: { participant: { profile_id: string } }) => x.participant.profile_id === id).participant.id as string;
  expect((await p.apiA.post(`/api/golf/scorecards/${rowOf(p.a.id)}/scores`, { data: { scores: [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 4 }] } })).status()).toBe(201);
  expect((await p.apiB.post(`/api/golf/scorecards/${rowOf(p.b.id)}/scores`, { data: { scores: [{ hole_number: 1, strokes: 5 }, { hole_number: 2, strokes: 4 }] } })).status()).toBe(201);
  const done = await p.apiA.post(`/api/sport-events/${p.eventId}/transition`, { data: { to: 'completed', override: true } });
  expect(done.ok(), await readErrorBody(done)).toBe(true);
  // Both mirrored rows carry the round's group post as their shared game (P2).
  const admin = adminClient();
  for (let i = 0; i < 40; i++) {
    const { data } = await admin.from('athlete_performances').select('profile_id').eq('context_key', `group_post:${gp}`);
    if ((data ?? []).length >= 2) return gp;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('the mirrored rows never carried the shared game');
}

async function dispose(p: Pair) {
  await cleanupEvent(p.apiA, p.eventId).catch(() => {});
  await Promise.all([p.apiA.dispose(), p.apiB.dispose(), p.anon.dispose()]);
  await deleteQaUser(p.a.id);
  await deleteQaUser(p.b.id);
}

test.beforeAll(async () => {
  const probe = await adminClient().from('athlete_rivalry_display').select('profile_id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 244 not applied on this target');
});

test('a shared round makes a rivalry: the athlete chooses what shows, the opponent sees their own record', async ({ browser }) => {
  test.setTimeout(180_000);
  const p = await mintPair();
  try {
    await playRound(p);
    const rivalsOfA = (api: APIRequestContext) => api.get(`/api/profile/${p.a.id}/rivals?sport=golf`);

    // The athlete: every rival, hidden by default.
    const own = await rivalsOfA(p.apiA);
    expect(own.headers()['cache-control']).toContain('no-store');
    const ownView = await own.json();
    expect(ownView).toMatchObject({ selfView: true, canManage: true, yours: null });
    expect(ownView.rivals).toHaveLength(1);
    expect(ownView.rivals[0]).toMatchObject({ shown: false, person: { profileId: p.b.id, name: 'Rival Bogey' }, record: { sportKey: 'golf', encounters: 1, versus: { wins: 1, losses: 0 }, lastFive: ['W'] } });

    // The opponent: only THEIR record, from their side; a stranger: nothing.
    const asB = await (await rivalsOfA(p.apiB)).json();
    expect(asB).toMatchObject({ selfView: false, canManage: false, rivals: [] });
    expect(asB.yours).toMatchObject({ versus: { wins: 0, losses: 1 }, lastFive: ['L'] });
    expect(await (await rivalsOfA(p.anon)).json()).toMatchObject({ rivals: [], yours: null });

    // Only the athlete chooses: B cannot show A's rivals; A shows B.
    expect((await p.apiB.put(`/api/profile/${p.a.id}/rivals`, { data: { opponentId: p.b.id, sportKey: 'golf', shown: true } })).status()).toBe(403);
    const show = await p.apiA.put(`/api/profile/${p.a.id}/rivals`, { data: { opponentId: p.b.id, sportKey: 'golf', shown: true } });
    expect(show.ok(), await readErrorBody(show)).toBe(true);
    const shown = await (await rivalsOfA(p.anon)).json();
    expect(shown.rivals.map((r: { person: { profileId: string } }) => r.person.profileId)).toEqual([p.b.id]);
    // B never sees themselves in A's list — their record is theirs, from their side.
    expect(await (await rivalsOfA(p.apiB)).json()).toMatchObject({ rivals: [], yours: { versus: { losses: 1 } } });
    // A private athlete's shown rivals stay behind the profile gate.
    await adminClient().from('profiles').update({ visibility: 'private' }).eq('id', p.a.id);
    expect(await (await rivalsOfA(p.anon)).json()).toMatchObject({ rivals: [] });
    await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', p.a.id);

    // The UI: the Stats hub's golf layer on the athlete's own page, the toggle, and the opponent's view.
    const ctxA = await browser.newContext({ storageState: await mintStorageState(p.a), extraHTTPHeaders: bypassHeaders() });
    const pageA = await ctxA.newPage();
    await pageA.goto(`/athlete/${p.a.id}?tab=stats&sport=golf`);
    const panel = pageA.locator('[data-rivals="golf"]');
    const row = panel.locator(`[data-rival="${p.b.id}"]`);
    await expect(row.locator('[data-rival-record]')).toHaveText('1–0', { timeout: 20_000 });
    const toggle = row.getByRole('button', { name: 'Shown' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(row.getByRole('button', { name: 'Show', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await (await rivalsOfA(p.anon)).json()).rivals.length).toBe(0);
    await ctxA.close();

    const ctxB = await browser.newContext({ storageState: await mintStorageState(p.b), extraHTTPHeaders: bypassHeaders() });
    const pageB = await ctxB.newPage();
    await pageB.goto(`/athlete/${p.a.id}?tab=stats&sport=golf`);
    await expect(pageB.locator('[data-rivals-yours] [data-rival-record]')).toHaveText('0–1', { timeout: 20_000 });
    await ctxB.close();
  } finally {
    await dispose(p);
  }
});

test('the opponent\'s own record on /u/ at phone width @mobile', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(180_000);
  const p = await mintPair();
  try {
    await playRound(p);
    const ctxB = await browser.newContext({ storageState: await mintStorageState(p.b), extraHTTPHeaders: bypassHeaders(), viewport: { width: 390, height: 844 } });
    const page = await ctxB.newPage();
    await page.goto(`/u/@${p.handleA}?tab=stats&sport=golf`);
    const yours = page.locator('[data-rivals-yours]');
    await expect(yours.locator('[data-rival-record]')).toHaveText('0–1', { timeout: 20_000 });
    await yours.scrollIntoViewIfNeeded();
    await expect(yours).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);
    await ctxB.close();
  } finally {
    await dispose(p);
  }
});
