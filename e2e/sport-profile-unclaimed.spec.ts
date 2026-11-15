import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 4 PR 6b (Nov 2026; migration 312) — the unclaimed page. A club tags
// a player who has no account. Their sport profile is open, marked
// "Unclaimed", under a short name. A person says "this is me" and starts a
// request; the club approves; the clips and stats of the club's games are on
// that person's own profile. The club can keep the page private instead.
const YT = 'jNQXAC9IVRw';
withOwnChannel([YT]);

interface Unclaimed { name: string; listed: boolean; can_manage: boolean; sports: Array<{ sportKey: string }>; mine: Array<{ status: string }>; requests: Array<{ id: string }> }

test('an unclaimed player: the open page, "this is me", the club approves and the film moves; the private switch — at 375 px @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const person = loadQaUser('user-c.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const club = await createQaOrg(admin, 'club', { name: `QA Unclaimed Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'soccer', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const personApi = await apiAs('state-c.json');
  const phone = { viewport: { width: 375, height: 800 }, extraHTTPHeaders: bypassHeaders() };
  const personCtx = await browser.newContext({ storageState: await mintStorageState(person), ...phone });
  const ownerCtx = await browser.newContext({ storageState: await mintStorageState(owner), ...phone });
  const since = new Date().toISOString();
  let videoId: string | null = null;
  let stubId: string | null = null;
  const goalsOf = async (as: typeof api, profileId: string): Promise<number> => {
    const r = await as.get(`/api/profile/${profileId}/sport-profile?sport=soccer`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return ((await r.json()) as { career: { totals: Record<string, number> } }).career.totals.goals ?? 0;
  };
  try {
    const member = await admin.from('memberships').insert({ org_id: club.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' });
    expect(member.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: club.id }, owner.id);
    let r = await api.post('/api/videos', { data: { url: `https://www.youtube.com/watch?v=${YT}`, title: `QA Unclaimed game ${stamp}`, side: 'club', org_id: club.id, sport_key: 'soccer' } });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    videoId = ((await r.json()).video as { id: string }).id;
    r = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'soccer', played_on: '2026-06-06', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(r.status(), await readErrorBody(r)).toBe(200);
    // The player with no account: a placeholder on the club's roster, tagged as the scorer of two goals.
    r = await api.post(`/api/videos/${videoId}/people`, { data: { name: `Sam Keeper${stamp.slice(-4)}`, side: 1 } });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    stubId = ((await r.json()).person as { id: string }).id;
    for (const ms of [1000, 5000]) {
      r = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: ms, label: 'Goal', event_key: 'goal', side: 1, period: 1, people: [{ profile_id: stubId, role: 'scorer' }] } });
      expect(r.status(), await readErrorBody(r)).toBe(201);
    }
    const before = await goalsOf(personApi, person.id);

    // 1. A signed-in person opens the player's profile: it is the unclaimed sport profile — the mark, the short name, the numbers.
    const page = await personCtx.newPage();
    await page.goto(`/athlete/${stubId}`);
    await expect(page).toHaveURL(new RegExp(`/athlete/${stubId}/sport/soccer$`), { timeout: 30_000 });
    const banner = page.locator('[data-unclaimed]');
    await expect(banner.locator('[data-unclaimed-mark]')).toHaveText('Unclaimed');
    await expect(banner).toContainText(`Tagged by QA Unclaimed Club ${stamp}`);
    await expect(page.locator('[data-sport-profile-owner]')).toContainText('Sam K.');
    await expect(page.locator('body')).not.toContainText(`Keeper${stamp.slice(-4)}`);
    await expect(page.locator('[data-sport-level="career"] [data-stat-row="career"] [data-stat="goals"]')).toHaveText('2', { timeout: 30_000 });
    expect(await fitsViewportWidth(page)).toBe(true);

    // 2. "This is me": a request — said back on the page, and the club's managers are told.
    await banner.locator('[data-unclaimed-ask-button]').click();
    await expect(banner.locator('[data-unclaimed-request="pending"]')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => ((await admin.from('notifications').select('id').eq('user_id', owner.id).eq('action_url', `/athlete/${stubId}/sport/soccer`).gte('created_at', since)).data ?? []).length, { timeout: 20_000 }).toBe(1);
    //    Asking again is the same request.
    expect((await personApi.post(`/api/profile/${stubId}/claim-request`)).status()).toBe(201);
    const { data: open } = await admin.from('profile_claim_requests').select('id').eq('profile_id', stubId);
    expect(open ?? []).toHaveLength(1);
    //    Nobody but the club answers it.
    expect((await personApi.patch(`/api/profile/${stubId}/claim-request/${(open![0] as { id: string }).id}`, { data: { action: 'approve' } })).status()).toBe(404);

    // 3. The club keeps the page private: the person no longer reaches it; the manager still does. Opened again.
    r = await api.patch(`/api/profile/${stubId}/unclaimed`, { data: { listed: false } });
    expect(r.status(), await readErrorBody(r)).toBe(200);
    expect((await personApi.get(`/api/profile/${stubId}/unclaimed`)).status()).toBe(404);
    expect((await personApi.get(`/api/profile/${stubId}/sport-profile?sport=soccer`)).status()).toBe(404);
    expect(((await (await api.get(`/api/profile/${stubId}/unclaimed`)).json()) as { unclaimed: Unclaimed }).unclaimed).toMatchObject({ listed: false, can_manage: true });
    r = await api.patch(`/api/profile/${stubId}/unclaimed`, { data: { listed: true } });
    expect(r.status(), await readErrorBody(r)).toBe(200);

    // 4. The club's manager, on the player's page: the request, and Approve.
    const theirs = await ownerCtx.newPage();
    await theirs.goto(`/athlete/${stubId}/sport/soccer`);
    const manage = theirs.locator('[data-unclaimed-manage]');
    await expect(manage.locator('[data-unclaimed-request-row]')).toHaveCount(1, { timeout: 30_000 });
    await expect(manage).toContainText('says they are this player');
    await manage.locator('[data-unclaimed-approve]').click();
    await expect(manage.locator('[data-unclaimed-requests="0"]')).toBeVisible({ timeout: 20_000 });
    expect(await fitsViewportWidth(theirs)).toBe(true);

    // 5. The film moved: the two goals are on the person's own profile; the placeholder's page has no games left.
    expect(await goalsOf(personApi, person.id)).toBe(before + 2);
    const after = ((await (await personApi.get(`/api/profile/${stubId}/unclaimed`)).json()) as { unclaimed: Unclaimed }).unclaimed;
    expect(after.sports).toEqual([]);
    expect(after.mine[0]).toMatchObject({ status: 'approved' });
    const { data: req } = await admin.from('profile_claim_requests').select('status, linked_count').eq('profile_id', stubId).single();
    expect(req).toMatchObject({ status: 'approved', linked_count: 2 });
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('notifications').delete().in('user_id', [owner.id, person.id]).eq('type', 'tag').gte('created_at', since);
    if (stubId) await deleteQaUser(stubId).catch(() => undefined);
    await api.dispose();
    await personApi.dispose();
    await personCtx.close();
    await ownerCtx.close();
    await deleteQaOrgs(admin, [club.id]);
  }
});
