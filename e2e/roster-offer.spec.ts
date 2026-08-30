import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// Roster offers (0.3): B (owner) invites member A from the member list; A
// sees the org-page banner + the metadata-tagged league_update notification,
// accepts, both sides render the Roster chip; B removes via confirm; then
// the decline path runs API-level on a re-invite. Two-user template from
// league-managers.spec.ts; a 375px block covers phone-width reachability.
test('roster: invite → banner → accept → remove; decline via API; 375px reachable', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

  const name = `QA Roster League ${Date.now()}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { error: memberError } = await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: userB.id, role: 'owner' },
    { league_id: leagueId, profile_id: userA.id, role: 'member' },
  ]);
  expect(memberError, memberError?.message).toBeNull();

  try {
    // B (owner) invites A from the member list.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/league/${leagueId}`);
      await pageB.getByRole('button', { name: 'Invite to roster' }).first().click();
      await expect(pageB.getByText('Roster invited')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByRole('button', { name: 'Cancel invite' })).toBeVisible();

      // A got the offer notification, disambiguated by metadata.
      const { data: offer } = await admin
        .from('notifications')
        .select('user_id, title, action_url')
        .eq('type', 'league_update')
        .contains('metadata', { roster: 'offer', league_id: leagueId });
      expect(offer).toHaveLength(1);
      expect(offer![0].user_id).toBe(userA.id);
      expect(offer![0].title).toBe(`${name} invited you to its roster`);
      expect(offer![0].action_url).toBe(`/league/${leagueId}`);

      // A: banner on the org page → accept → chip renders, banner gone.
      await page.goto(`/league/${leagueId}`);
      await expect(page.getByText(`You've been invited to the ${name} roster`)).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('button', { name: 'Accept' }).click();
      await expect(page.getByText(`You've been invited to the ${name} roster`)).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(page.getByText('Roster', { exact: true })).toBeVisible();

      // Server truth: the roster row is active; owner got the accept notice.
      const { data: rosterRow } = await admin
        .from('memberships')
        .select('status')
        .eq('league_id', leagueId)
        .eq('profile_id', userA.id)
        .eq('kind', 'roster')
        .single();
      expect(rosterRow?.status).toBe('active');
      const { data: accepted } = await admin
        .from('notifications')
        .select('user_id')
        .eq('type', 'league_update')
        .contains('metadata', { roster: 'accepted', league_id: leagueId });
      expect(accepted).toHaveLength(1);
      expect(accepted![0].user_id).toBe(userB.id);

      // B removes A from the roster through the confirm.
      await pageB.reload();
      await pageB.getByRole('button', { name: 'Remove from roster' }).click();
      await pageB.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(pageB.getByRole('button', { name: 'Invite to roster' }).first()).toBeVisible({
        timeout: 15_000,
      });
      const { data: removedNotif } = await admin
        .from('notifications')
        .select('user_id, title')
        .eq('type', 'league_update')
        .contains('metadata', { roster: 'removed', league_id: leagueId });
      expect(removedNotif).toHaveLength(1);
      expect(removedNotif![0].user_id).toBe(userA.id);
    } finally {
      await ctxB.close();
    }

    // Decline path, API-level: B re-invites, A declines, row gone, owner
    // notified.
    const apiB = await apiAs('state-b.json');
    const apiA = await apiAs('state.json');
    try {
      const invite = await apiB.post(
        `/api/leagues/${leagueId}/roster?profileId=${userA.id}`
      );
      expect(invite.ok(), JSON.stringify(await invite.json())).toBe(true);
      const decline = await apiA.delete(`/api/leagues/${leagueId}/roster`);
      expect(decline.ok(), JSON.stringify(await decline.json())).toBe(true);
      expect((await decline.json()).action).toBe('declined');
      const { data: gone } = await admin
        .from('memberships')
        .select('id')
        .eq('league_id', leagueId)
        .eq('profile_id', userA.id)
        .eq('kind', 'roster');
      expect(gone ?? []).toHaveLength(0);
      const { data: declinedNotif } = await admin
        .from('notifications')
        .select('user_id')
        .eq('type', 'league_update')
        .contains('metadata', { roster: 'declined', league_id: leagueId });
      expect(declinedNotif).toHaveLength(1);
      expect(declinedNotif![0].user_id).toBe(userB.id);
    } finally {
      await apiB.dispose();
      await apiA.dispose();
    }

    // Phone-width reachability (375px): B re-invites via API, then A's
    // banner and B's roster controls are visible and clickable at 375px.
    const apiB2 = await apiAs('state-b.json');
    try {
      const reinvite = await apiB2.post(
        `/api/leagues/${leagueId}/roster?profileId=${userA.id}`
      );
      expect(reinvite.ok()).toBe(true);
    } finally {
      await apiB2.dispose();
    }
    const mobileA = await browser.newContext({
      storageState: 'e2e/.auth/state.json',
      viewport: { width: 375, height: 667 },
    });
    const mobileB = await browser.newContext({
      storageState: 'e2e/.auth/state-b.json',
      viewport: { width: 375, height: 667 },
    });
    try {
      const pageMA = await mobileA.newPage();
      await pageMA.goto(`/league/${leagueId}`);
      const banner = pageMA.getByText(`You've been invited to the ${name} roster`);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(pageMA.getByRole('button', { name: 'Accept' })).toBeVisible();
      const pageMB = await mobileB.newPage();
      await pageMB.goto(`/league/${leagueId}`);
      const cancelBtn = pageMB.getByRole('button', { name: 'Cancel invite' });
      await cancelBtn.scrollIntoViewIfNeeded();
      await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
      await cancelBtn.click({ trial: true });
    } finally {
      await mobileA.close();
      await mobileB.close();
    }
  } finally {
    await admin.from('notifications').delete().eq('type', 'league_update').eq('user_id', userA.id);
    await admin.from('notifications').delete().eq('type', 'league_update').eq('user_id', userB.id);
    await admin.from('leagues').delete().eq('id', leagueId); // memberships cascade
  }
});
