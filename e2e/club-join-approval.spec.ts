import { test, expect, request } from '@playwright/test';
import { E2E_BASE_URL, adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, mintStorageState, resetRateBucket } from './helpers/qa-user';

// Phase 9 V2 — join with approval. On an approval club a join POST queues a
// request (club_join_requests — never a pending membership): the owner is
// belled, the requester is NOT a member (no role, no count change), a
// repeat withdraws, a manager approves (the member appears, a bell lands)
// or declines; an open club still joins instantly. The club page shows the
// request state; the console shows the queue at 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('join approval: request → bell + not a member → withdraw → request → approve → member; decline path; open club instant; console + page at 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const gamma = await createQaUser({ firstName: 'Gale', lastName: 'Declinetest' });
  await resetRateBucket(admin, 'club-join', alpha.id);
  await resetRateBucket(admin, 'club-join', gamma.id);
  const probe = await admin.from('club_join_requests').select('id').limit(1);
  test.skip(!!probe.error, `club_join_requests missing — run migration 176 (${probe.error?.message})`);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Approval Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf', join_policy: 'approval' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  const { data: openClub } = await admin
    .from('clubs')
    .insert({ name: `QA Open Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const openClubId = openClub!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: openClubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    const memberCount = async (id: string) => ((await (await ownerApi.get(`/api/clubs/${id}`)).json()) as { memberCount: number }).memberCount;
    const before = await memberCount(clubId);

    // The request.
    let res = await alphaApi.post(`/api/clubs/${clubId}/members`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const asked = (await res.json()) as { action: string; requestId: string };
    expect(asked.action).toBe('requested');
    const { data: reqRow } = await admin.from('club_join_requests').select('id, profile_id').eq('club_id', clubId).eq('profile_id', alpha.id).single();
    expect(reqRow!.id).toBe(asked.requestId);
    // Not a member: no role, no count change, the GET says the request is pending.
    res = await alphaApi.get(`/api/clubs/${clubId}`);
    const view = (await res.json()) as { viewerRole: string | null; viewerRequestPending: boolean; joinPolicy: string };
    expect(view.viewerRole).toBeNull();
    expect(view.viewerRequestPending).toBe(true);
    expect(view.joinPolicy).toBe('approval');
    expect(await memberCount(clubId)).toBe(before);
    const { data: rows } = await admin.from('memberships').select('id').eq('club_id', clubId).eq('profile_id', alpha.id);
    expect(rows ?? []).toHaveLength(0);
    // The owner's bell.
    const { data: bells } = await admin.from('notifications').select('user_id, title, metadata').contains('metadata', { request_id: asked.requestId, join_request: true });
    expect(bells!.map(b => b.user_id)).toEqual([owner.id]);
    expect(bells![0].title).toContain('asked to join');

    // A repeat withdraws; a further POST re-asks (a new request id).
    res = await alphaApi.post(`/api/clubs/${clubId}/members`);
    expect(((await res.json()) as { action: string }).action).toBe('request_cancelled');
    res = await alphaApi.post(`/api/clubs/${clubId}/members`);
    const asked2 = (await res.json()) as { action: string; requestId: string };
    expect(asked2.action).toBe('requested');

    // A member cannot read or decide the queue; the owner can.
    res = await alphaApi.get(`/api/clubs/${clubId}/join-requests`);
    expect(res.status()).toBe(403);
    res = await ownerApi.get(`/api/clubs/${clubId}/join-requests`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const queue = (await res.json()) as { requests: { id: string; name: string }[] };
    expect(queue.requests.map(r => r.id)).toEqual([asked2.requestId]);

    // Approve → a member, the request gone, a bell to alpha; a repeat 409s.
    res = await ownerApi.patch(`/api/clubs/${clubId}/join-requests`, { data: { requestId: asked2.requestId, decision: 'approve' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.get(`/api/clubs/${clubId}`);
    const after = (await res.json()) as { viewerRole: string | null; viewerRequestPending: boolean };
    expect(after.viewerRole).toBe('member');
    expect(after.viewerRequestPending).toBe(false);
    expect(await memberCount(clubId)).toBe(before + 1);
    const { data: decided } = await admin.from('notifications').select('user_id, title').contains('metadata', { request_id: asked2.requestId, join_decision: 'approved' });
    expect(decided!.map(d => d.user_id)).toEqual([alpha.id]);
    expect(decided![0].title).toContain("You're now a member of");
    res = await ownerApi.patch(`/api/clubs/${clubId}/join-requests`, { data: { requestId: asked2.requestId, decision: 'approve' } });
    expect(res.status()).toBe(409);

    // Decline path (a third user).
    const gammaApi = await request.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(gamma) });
    let gammaRequestId = '';
    try {
      res = await gammaApi.post(`/api/clubs/${clubId}/members`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      gammaRequestId = ((await res.json()) as { requestId: string }).requestId;
    } finally {
      await gammaApi.dispose();
    }
    res = await ownerApi.patch(`/api/clubs/${clubId}/join-requests`, { data: { requestId: gammaRequestId, decision: 'decline' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: gammaRows } = await admin.from('memberships').select('id').eq('club_id', clubId).eq('profile_id', gamma.id);
    expect(gammaRows ?? []).toHaveLength(0);
    const { data: declined } = await admin.from('notifications').select('user_id').contains('metadata', { request_id: gammaRequestId, join_decision: 'declined' });
    expect(declined!.map(d => d.user_id)).toEqual([gamma.id]);

    // An open club still joins instantly.
    res = await alphaApi.post(`/api/clubs/${openClubId}/members`);
    expect(((await res.json()) as { action: string }).action).toBe('joined');

    // The console queue and the club page at 375px.
    await admin.from('memberships').delete().eq('club_id', clubId).eq('profile_id', alpha.id); // back to a stranger
    res = await alphaApi.post(`/api/clubs/${clubId}/members`);
    const asked3 = (await res.json()) as { requestId: string };
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    const alphaCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 812 } });
    try {
      const ap = await alphaCtx.newPage();
      await ap.goto(`/club/${clubId}`);
      await expect(ap.getByRole('button', { name: 'Request sent · withdraw' })).toBeVisible({ timeout: 20_000 });
      const op = await ownerCtx.newPage();
      await op.goto(`/app/org/club/${clubId}`);
      await expect(op.getByRole('heading', { name: /Membership requests \(1\)/, level: 3 })).toBeVisible({ timeout: 20_000 });
      expect(await op.evaluate(() => document.documentElement.scrollWidth), 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      await op.getByRole('button', { name: 'Approve' }).click();
      await expect(op.getByText('Member approved')).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(async () => ((await (await alphaApi.get(`/api/clubs/${clubId}`)).json()) as { viewerRole: string | null }).viewerRole, { timeout: 15_000 })
        .toBe('member');
      await ap.reload();
      await expect(ap.getByRole('button', { name: 'Leave club' })).toBeVisible({ timeout: 20_000 });
      const { data: gone } = await admin.from('club_join_requests').select('id').eq('id', asked3.requestId);
      expect(gone ?? []).toHaveLength(0);
    } finally {
      await ownerCtx.close();
      await alphaCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await admin.from('notifications').delete().contains('metadata', { club_id: clubId });
    await admin.from('clubs').delete().in('id', [clubId, openClubId]);
    await deleteQaUser(gamma.id);
  }
});
