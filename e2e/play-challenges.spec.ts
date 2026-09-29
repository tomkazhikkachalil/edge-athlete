import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';

// Play program P8 (Sep 28 2026): friend challenges, settled by real results.
// Tom: mutual follows only; every result counts, a verified one is marked.
// Two fresh athletes follow each other; A challenges B to 20+ points; B
// accepts FROM THE BELL; B's real stat line of 22 wins it (the post-write
// hook) and both hear. Then the refusals: a stranger, a decline, a block,
// challenges switched off. Fresh users — nothing leaks between specs.

interface Trio { a: QaUser; b: QaUser; c: QaUser; apiA: APIRequestContext; apiB: APIRequestContext; apiC: APIRequestContext }

async function trio(): Promise<Trio> {
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Challenger Ann', firstName: 'Challenger', lastName: 'Ann' });
  const b = await createQaUser({ displayName: 'Challengee Bo', firstName: 'Challengee', lastName: 'Bo' });
  const c = await createQaUser({ displayName: 'Stranger Cy', firstName: 'Stranger', lastName: 'Cy' });
  const { error } = await admin.from('follows').insert([
    { follower_id: a.id, following_id: b.id, status: 'accepted' },
    { follower_id: b.id, following_id: a.id, status: 'accepted' },
    { follower_id: c.id, following_id: b.id, status: 'accepted' }, // one way only — never mutual
  ]);
  expect(error, error?.message).toBeNull();
  const ctx = async (u: QaUser) => pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  return { a, b, c, apiA: await ctx(a), apiB: await ctx(b), apiC: await ctx(c) };
}

async function dispose(t: Trio) {
  await Promise.all([t.apiA.dispose(), t.apiB.dispose(), t.apiC.dispose()]);
  for (const u of [t.a, t.b, t.c]) await deleteQaUser(u.id);
}

const today = () => new Date().toISOString().slice(0, 10);

test.beforeAll(async () => {
  const probe = await adminClient().from('challenges').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 244 not applied on this target');
});

test('a challenge is sent to a mutual follow, accepted from the bell, and won by a real result', async () => {
  test.setTimeout(150_000);
  const t = await trio();
  const admin = adminClient();
  try {
    // The picker offers mutual follows only.
    const people = await (await t.apiA.get('/api/challenges/people')).json();
    expect(people.people.map((p: { id: string }) => p.id)).toEqual([t.b.id]);

    const sent = await t.apiA.post('/api/challenges', { data: { challengeeId: t.b.id, sportKey: 'basketball', metric: 'points', target: 20, days: 14, message: 'Bet you cannot.' } });
    expect(sent.status(), await readErrorBody(sent)).toBe(201);
    const challenge = (await sent.json()).challenge;
    expect(challenge).toMatchObject({ status: 'pending', direction: 'higher', starts_on: today() });

    // B's bell asks, with Accept / Decline.
    const { data: bells } = await admin.from('notifications').select('id, title, action_status, message').eq('user_id', t.b.id).eq('type', 'challenge');
    expect(bells).toHaveLength(1);
    expect(bells![0]).toMatchObject({ title: 'Challenger Ann challenged you', action_status: 'pending' });
    expect(bells![0].message).toMatch(/^20\+ points by /);

    // A stranger cannot answer it; B accepts from the bell.
    expect((await t.apiC.post(`/api/challenges/${challenge.id}`, { data: { action: 'accept' } })).status()).toBe(404);
    const accepted = await t.apiB.post(`/api/notifications/${bells![0].id}/action`, { data: { action: 'accept' } });
    expect(accepted.ok(), await readErrorBody(accepted)).toBe(true);
    expect(await accepted.json()).toMatchObject({ action_status: 'accepted', challenge_status: 'accepted' });

    // B's real game: 22 points → the post-write hook wins the challenge.
    const post = await t.apiB.post('/api/posts', {
      data: { caption: `Challenge game ${Date.now()}`, visibility: 'private', postType: 'basketball', stats_data: { type: 'stat_line', sport_key: 'basketball', date: today(), opponent: 'QA Hoops', stats: { points: 22, rebounds: 5 } } },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    let row: Record<string, unknown> | null = null;
    for (let i = 0; i < 40 && row?.status !== 'won'; i++) {
      row = (await admin.from('challenges').select('status, settled_value, verified, settled_key').eq('id', challenge.id).single()).data;
      if (row?.status !== 'won') await new Promise(r => setTimeout(r, 500));
    }
    expect(row).toMatchObject({ status: 'won', verified: false });
    expect(Number(row!.settled_value)).toBe(22);
    const { data: results } = await admin.from('notifications').select('user_id, title').eq('type', 'challenge_result').in('user_id', [t.a.id, t.b.id]);
    expect(results!.find(r => r.user_id === t.b.id && r.title === 'Challenge won: 22')).toBeTruthy();
    expect(results!.find(r => r.user_id === t.a.id && r.title === 'Challengee Bo met your challenge')).toBeTruthy();

    // Both see it in their lists; nobody else may read B's.
    const listB = await (await t.apiB.get('/api/challenges')).json();
    expect(listB.challenges[0]).toMatchObject({ id: challenge.id, role: 'challengee', otherName: 'Challenger Ann', status: 'won' });
    expect((await t.apiC.get(`/api/challenges?profileId=${t.b.id}`)).status()).toBe(403);
  } finally {
    await dispose(t);
  }
});

test('the refusals: not mutual, a decline, a block, challenges switched off', async () => {
  test.setTimeout(120_000);
  const t = await trio();
  const admin = adminClient();
  const body = (to: string) => ({ data: { challengeeId: to, sportKey: 'golf', metric: 'gross', target: 78, days: 30 } });
  try {
    // C follows B, B does not follow C: not mutual — and the refusal never says which rule.
    const notMutual = await t.apiC.post('/api/challenges', body(t.b.id));
    expect(notMutual.status()).toBe(403);
    expect((await notMutual.json()).error).toBe('You can challenge people you follow who follow you back.');

    // A decline: the challengee passes; the challenger hears; a second answer is refused.
    const sent = await t.apiA.post('/api/challenges', body(t.b.id));
    expect(sent.status(), await readErrorBody(sent)).toBe(201);
    const id = (await sent.json()).challenge.id;
    expect((await t.apiA.post(`/api/challenges/${id}`, { data: { action: 'accept' } })).status(), 'the challenger cannot accept their own').toBe(409);
    expect((await (await t.apiB.post(`/api/challenges/${id}`, { data: { action: 'decline' } })).json()).status).toBe('declined');
    expect((await t.apiB.post(`/api/challenges/${id}`, { data: { action: 'accept' } })).status()).toBe(409);
    const { data: passed } = await admin.from('notifications').select('title').eq('user_id', t.a.id).eq('type', 'challenge_result');
    expect(passed!.map(n => n.title)).toContain('Challengee Bo passed on your challenge');

    // A cancel: the challenger calls off a pending one.
    const again = await (await t.apiA.post('/api/challenges', body(t.b.id))).json();
    expect((await (await t.apiA.post(`/api/challenges/${again.challenge.id}`, { data: { action: 'cancel' } })).json()).status).toBe('cancelled');

    // Challenges switched off → refused by name.
    await admin.from('notification_preferences').upsert({ user_id: t.b.id, challenges_enabled: false }, { onConflict: 'user_id' });
    const off = await t.apiA.post('/api/challenges', body(t.b.id));
    expect(off.status()).toBe(403);
    expect((await off.json()).error).toBe('They are not taking challenges right now.');
    await admin.from('notification_preferences').update({ challenges_enabled: true }).eq('user_id', t.b.id);

    // A block (either way) reads exactly like "not mutual".
    await admin.from('user_blocks').insert({ blocker_id: t.b.id, blocked_id: t.a.id });
    const blocked = await t.apiA.post('/api/challenges', body(t.b.id));
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error).toBe('You can challenge people you follow who follow you back.');
    expect((await (await t.apiA.get('/api/challenges/people')).json()).people).toEqual([]);
  } finally {
    await adminClient().from('user_blocks').delete().eq('blocker_id', t.b.id);
    await dispose(t);
  }
});

// P9: the UI. A dares B from A's OWN round card ("Beat my 77", prefilled);
// B lands on the bell's link — their Stats, on golf, the challenge
// highlighted — and accepts there. Desktop and phone width.
for (const phone of [false, true]) {
  test(`challenge from your own round, accept in the Stats panel${phone ? ' @mobile' : ''}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const t = await trio();
    const viewport = phone ? { width: 390, height: 844 } : undefined;
    try {
      const holes = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, score: i === 0 ? 3 : i <= 6 ? 5 : 4 }));
      const made = await t.apiA.post('/api/posts', { data: { caption: `Dare round ${Date.now()}`, visibility: 'private', postType: 'golf', golfData: { date: today(), courseName: 'QA Dare Links', holes: '18', coursePar: 72, holesData: holes } } });
      expect(made.ok(), await readErrorBody(made)).toBe(true);
      const postId = (await made.json()).post.id as string;

      const ctxA = await browser.newContext({ storageState: await mintStorageState(t.a), extraHTTPHeaders: bypassHeaders(), ...(viewport ? { viewport } : {}) });
      const pageA = await ctxA.newPage();
      await pageA.goto(`/feed?post=${postId}`);
      // ?post= opens the post in its modal over the feed — the one on top is the LAST in the DOM.
      // Let the feed settle first: its first data pass re-renders the modal.
      await pageA.waitForLoadState('networkidle');
      const dare = pageA.locator('[data-post-challenge]').last();
      await expect(dare).toBeVisible({ timeout: 20_000 });
      await dare.click({ timeout: 15_000 });
      const composer = pageA.locator('[data-challenge-composer]');
      await expect(composer.locator('select[name="challengee"]')).toBeVisible({ timeout: 15_000 });
      await composer.locator('select[name="challengee"]').selectOption(t.b.id, { timeout: 15_000 });
      await expect(composer.locator('input[name="target"]')).toHaveValue('77');
      await expect(composer.locator('[data-challenge-preview]')).toContainText('Shoot under 77 (18 holes) at QA Dare Links');
      await composer.getByRole('button', { name: 'Send challenge' }).click({ timeout: 15_000 });
      await expect(pageA.getByText('Challenge sent')).toBeVisible({ timeout: 15_000 });
      await ctxA.close();

      const { data: bell } = await adminClient().from('notifications').select('action_url, metadata').eq('user_id', t.b.id).eq('type', 'challenge').single();
      const challengeId = (bell!.metadata as { challenge_id: string }).challenge_id;
      expect(bell!.action_url).toBe(`/athlete?tab=stats&sport=golf&challenge=${challengeId}`);

      const ctxB = await browser.newContext({ storageState: await mintStorageState(t.b), extraHTTPHeaders: bypassHeaders(), ...(viewport ? { viewport } : {}) });
      const pageB = await ctxB.newPage();
      await pageB.goto(bell!.action_url as string);
      const item = pageB.locator(`[data-challenge="${challengeId}"]`);
      await expect(item).toContainText('Challenger Ann challenged you', { timeout: 25_000 });
      await item.getByRole('button', { name: 'Accept' }).click({ timeout: 15_000 });
      await expect(item).toHaveAttribute('data-challenge-status', 'accepted', { timeout: 15_000 });
      if (phone) {
        const overflow = await pageB.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);
      }
      await ctxB.close();
    } finally {
      await dispose(t);
    }
  });
}
