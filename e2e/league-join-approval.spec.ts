import { test, expect, request } from '@playwright/test';
import { E2E_BASE_URL, adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, mintStorageState, resetRateBucket } from './helpers/qa-user';

// Program 11 L1 — join with approval, the league twin of club-join-approval.
// On an approval league a join POST queues a request (league_join_requests
// — never a pending membership): the owner is belled (league_join), the
// requester is NOT a member (no role, no count change), a repeat withdraws,
// a manager approves (the member appears, a league_update bell lands) or
// declines; an open league still joins instantly. The league page shows
// the request state; the console shows the queue at 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('league join approval: request → bell + not a member → withdraw → request → approve → member; decline path; open league instant; console + page at 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const gamma = await createQaUser({ firstName: 'Gale', lastName: 'Declinetest' });
  await resetRateBucket(admin, 'league-join', alpha.id);
  await resetRateBucket(admin, 'league-join', gamma.id);
  const probe = await admin.from('league_join_requests').select('id').limit(1);
  test.skip(!!probe.error, `league_join_requests missing — run migration 177 (${probe.error?.message})`);

  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Approval League ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf', join_policy: 'approval' })
    .select('id')
    .single();
  const leagueId = league!.id as string;
  const { data: openLeague } = await admin
    .from('leagues')
    .insert({ name: `QA Open League ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf' })
    .select('id')
    .single();
  const openLeagueId = openLeague!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: openLeagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    const memberCount = async (id: string) => ((await (await ownerApi.get(`/api/leagues/${id}`)).json()) as { memberCount: number }).memberCount;
    const before = await memberCount(leagueId);

    // The request.
    let res = await alphaApi.post(`/api/leagues/${leagueId}/members`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const asked = (await res.json()) as { action: string; requestId: string };
    expect(asked.action).toBe('requested');
    const { data: reqRow } = await admin.from('league_join_requests').select('id, profile_id').eq('league_id', leagueId).eq('profile_id', alpha.id).single();
    expect(reqRow!.id).toBe(asked.requestId);
    // Not a member: no role, no count change, the GET says the request is pending.
    res = await alphaApi.get(`/api/leagues/${leagueId}`);
    const view = (await res.json()) as { viewerRole: string | null; viewerRequestPending: boolean; joinPolicy: string };
    expect(view.viewerRole).toBeNull();
    expect(view.viewerRequestPending).toBe(true);
    expect(view.joinPolicy).toBe('approval');
    expect(await memberCount(leagueId)).toBe(before);
    const { data: rows } = await admin.from('memberships').select('id').eq('league_id', leagueId).eq('profile_id', alpha.id);
    expect(rows ?? []).toHaveLength(0);
    // The owner's bell (league_join, a join_request).
    const { data: bells } = await admin
      .from('notifications')
      .select('user_id, type, title, metadata')
      .contains('metadata', { request_id: asked.requestId, join_request: true });
    expect(bells!.map(b => b.user_id)).toEqual([owner.id]);
    expect(bells![0].type).toBe('league_join');
    expect(bells![0].title).toContain('asked to join');

    // A repeat withdraws; a further POST re-asks (a new request id).
    res = await alphaApi.post(`/api/leagues/${leagueId}/members`);
    expect(((await res.json()) as { action: string }).action).toBe('request_cancelled');
    res = await alphaApi.post(`/api/leagues/${leagueId}/members`);
    const asked2 = (await res.json()) as { action: string; requestId: string };
    expect(asked2.action).toBe('requested');

    // A member cannot read or decide the queue; the owner can.
    res = await alphaApi.get(`/api/leagues/${leagueId}/join-requests`);
    expect(res.status()).toBe(403);
    res = await ownerApi.get(`/api/leagues/${leagueId}/join-requests`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const queue = (await res.json()) as { requests: { id: string; name: string }[] };
    expect(queue.requests.map(r => r.id)).toEqual([asked2.requestId]);

    // Approve → a member, the request gone, a bell to alpha; a repeat 409s.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/join-requests`, { data: { requestId: asked2.requestId, decision: 'approve' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.get(`/api/leagues/${leagueId}`);
    const after = (await res.json()) as { viewerRole: string | null; viewerRequestPending: boolean };
    expect(after.viewerRole).toBe('member');
    expect(after.viewerRequestPending).toBe(false);
    expect(await memberCount(leagueId)).toBe(before + 1);
    const { data: decided } = await admin
      .from('notifications')
      .select('user_id, type, title')
      .contains('metadata', { request_id: asked2.requestId, join_decision: 'approved' });
    expect(decided!.map(d => d.user_id)).toEqual([alpha.id]);
    expect(decided![0].type).toBe('league_update');
    expect(decided![0].title).toContain("You're now a member of");
    res = await ownerApi.patch(`/api/leagues/${leagueId}/join-requests`, { data: { requestId: asked2.requestId, decision: 'approve' } });
    expect(res.status()).toBe(409);

    // Decline path (a third user).
    const gammaApi = await request.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(gamma) });
    let gammaRequestId = '';
    try {
      res = await gammaApi.post(`/api/leagues/${leagueId}/members`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      gammaRequestId = ((await res.json()) as { requestId: string }).requestId;
    } finally {
      await gammaApi.dispose();
    }
    res = await ownerApi.patch(`/api/leagues/${leagueId}/join-requests`, { data: { requestId: gammaRequestId, decision: 'decline' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: gammaRows } = await admin.from('memberships').select('id').eq('league_id', leagueId).eq('profile_id', gamma.id);
    expect(gammaRows ?? []).toHaveLength(0);
    const { data: declined } = await admin.from('notifications').select('user_id').contains('metadata', { request_id: gammaRequestId, join_decision: 'declined' });
    expect(declined!.map(d => d.user_id)).toEqual([gamma.id]);

    // An open league still joins instantly.
    res = await alphaApi.post(`/api/leagues/${openLeagueId}/members`);
    expect(((await res.json()) as { action: string }).action).toBe('joined');

    // The console queue and the league page at 375px.
    await admin.from('memberships').delete().eq('league_id', leagueId).eq('profile_id', alpha.id); // back to a stranger
    res = await alphaApi.post(`/api/leagues/${leagueId}/members`);
    const asked3 = (await res.json()) as { requestId: string };
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    const alphaCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 812 } });
    try {
      const ap = await alphaCtx.newPage();
      await ap.goto(`/league/${leagueId}`);
      await expect(ap.getByRole('button', { name: 'Request sent · withdraw' })).toBeVisible({ timeout: 20_000 });
      const op = await ownerCtx.newPage();
      await op.goto(`/app/org/league/${leagueId}`);
      await expect(op.getByRole('heading', { name: /Membership requests \(1\)/, level: 3 })).toBeVisible({ timeout: 20_000 });
      expect(await op.evaluate(() => document.documentElement.scrollWidth), 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      await op.getByRole('button', { name: 'Approve' }).click();
      await expect(op.getByText('Member approved')).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(async () => ((await (await alphaApi.get(`/api/leagues/${leagueId}`)).json()) as { viewerRole: string | null }).viewerRole, { timeout: 15_000 })
        .toBe('member');
      await ap.reload();
      await expect(ap.getByRole('button', { name: 'Leave league' })).toBeVisible({ timeout: 20_000 });
      const { data: gone } = await admin.from('league_join_requests').select('id').eq('id', asked3.requestId);
      expect(gone ?? []).toHaveLength(0);
    } finally {
      await ownerCtx.close();
      await alphaCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await admin.from('notifications').delete().contains('metadata', { league_id: leagueId });
    await admin.from('notifications').delete().contains('metadata', { league_id: openLeagueId });
    await admin.from('leagues').delete().in('id', [leagueId, openLeagueId]);
    await deleteQaUser(gamma.id);
  }
});
