import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaChild, deleteQaUser, loadQaUser } from './helpers/qa-user';

// Guardian roster gate (0.10, mig 147; its launch flag retired):
// an offer to a supervised child creates the pending row, bells the child
// AND the guardians (roster_invite), surfaces in the guardian queue, and
// the guardian accepts acting-for (either-approves — the child's own
// accept is covered by the prod probe, which can mint a child session).
// Skips when the flag is off in the target env (the 403 IS the flag probe).
test('guardian roster: offer → guardian bell + queue → accept acting-for; decline path; 375px console', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const guardian = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Guardian League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  let childId: string | null = null;
  try {
    childId = await createQaChild(guardian.id, {
      firstName: 'Rory',
      handle: `qa-roster-kid-${stamp.toString(36)}`,
    });
    // roster ⊆ follow: the child must be a member before an offer can land.
    const { error: memberError } = await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
      { league_id: leagueId, profile_id: childId, role: 'member' },
    ]);
    expect(memberError, memberError?.message).toBeNull();

    const apiOwner = await apiAs('state-b.json');
    const apiGuardian = await apiAs('state.json');
    try {
      // The either-approves flow is permanent (the 0.10 flag retired) —
      // the offer must succeed on every target.
      const offer = await apiOwner.post(`/api/leagues/${leagueId}/roster?profileId=${childId}`);
      expect(offer.ok(), String(offer.status())).toBe(true);

      // Pending row + both notification halves.
      const { data: pendingRow } = await admin
        .from('memberships')
        .select('id, status')
        .eq('league_id', leagueId)
        .eq('profile_id', childId)
        .eq('kind', 'roster')
        .maybeSingle();
      expect(pendingRow?.status).toBe('pending');
      const { data: guardianBell } = await admin
        .from('notifications')
        .select('id, title, metadata')
        .eq('user_id', guardian.id)
        .eq('type', 'roster_invite')
        .contains('metadata', { league_id: leagueId, roster: 'offer' });
      expect(guardianBell?.length, 'guardian roster_invite bell').toBe(1);
      expect(guardianBell![0].title).toContain('Rory');
      const { data: childBell } = await admin
        .from('notifications')
        .select('id')
        .eq('user_id', childId)
        .eq('type', 'league_update')
        .contains('metadata', { league_id: leagueId, roster: 'offer' });
      expect(childBell?.length, 'child offer bell (parallel-notify)').toBe(1);

      // The guardian queue lists it.
      const queue = await apiGuardian.get('/api/guardian/queue');
      expect(queue.ok()).toBe(true);
      const items = (await queue.json()).items as Array<{ kind: string; id: string; org?: { name: string } }>;
      const queueItem = items.find(i => i.kind === 'roster_invite');
      expect(queueItem, 'roster_invite in the guardian queue').toBeTruthy();
      expect(queueItem!.org!.name).toBe(name);

      // 375px console: the row + both decide buttons visible and legible.
      const ctx = await browser.newContext({
        storageState: 'e2e/.auth/state.json',
        viewport: { width: 375, height: 812 },
      });
      try {
        const pageM = await ctx.newPage();
        await pageM.goto('/app/guardian');
        await expect(pageM.getByText(`${name} invited Rory to its roster`)).toBeVisible({ timeout: 20_000 });
        await expect(pageM.getByRole('button', { name: 'Accept' }).first()).toBeVisible();
        await expect(pageM.getByRole('button', { name: 'Decline' }).first()).toBeVisible();
      } finally {
        await ctx.close();
      }

      // Guardian accepts acting-for → row active + the child hears.
      const accept = await apiGuardian.patch(`/api/leagues/${leagueId}/roster`, {
        data: { action: 'accept', profileId: childId },
      });
      expect(accept.ok(), String(accept.status())).toBe(true);
      const { data: activeRow } = await admin
        .from('memberships')
        .select('status')
        .eq('id', pendingRow!.id)
        .maybeSingle();
      expect(activeRow?.status).toBe('active');
      const { data: childTold } = await admin
        .from('notifications')
        .select('id, title')
        .eq('user_id', childId)
        .eq('type', 'league_update')
        .contains('metadata', { league_id: leagueId, roster: 'accepted' });
      expect(childTold?.length, 'child told of guardian accept').toBe(1);
      expect(childTold![0].title).toContain('Your guardian accepted');

      // Reset → the guardian DECLINE path (as=guardian, self-equivalent).
      await admin.from('memberships').delete().eq('id', pendingRow!.id);
      const reOffer = await apiOwner.post(`/api/leagues/${leagueId}/roster?profileId=${childId}`);
      expect(reOffer.ok()).toBe(true);
      const decline = await apiGuardian.delete(
        `/api/leagues/${leagueId}/roster?profileId=${childId}&as=guardian`
      );
      expect(decline.ok(), String(decline.status())).toBe(true);
      expect((await decline.json()).action).toBe('declined');
      const { data: goneRow } = await admin
        .from('memberships')
        .select('id')
        .eq('league_id', leagueId)
        .eq('profile_id', childId)
        .eq('kind', 'roster');
      expect(goneRow?.length).toBe(0);

      // A non-guardian stranger can't act for the child.
      const strangerAccept = await apiOwner.patch(`/api/leagues/${leagueId}/roster`, {
        data: { action: 'accept', profileId: childId },
      });
      expect(strangerAccept.status()).toBe(403);
    } finally {
      await apiOwner.dispose();
      await apiGuardian.dispose();
    }
  } finally {
    await admin.from('notifications').delete().eq('user_id', guardian.id).eq('type', 'roster_invite');
    if (childId) await deleteQaUser(childId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
