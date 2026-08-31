import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The club↔league handshake (118) — the headline: NO admin needed. A owns a
// seeded club, B owns a seeded league; B invites from the league page, A
// accepts from the club page, both pages cross-list from server truth.
// Matrix edges via the API: self-accept 403, duplicate 409, non-manager 403.
test('affiliation: league invites, club accepts, both pages cross-list', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('league_clubs').select('league_id').limit(1);
  test.skip(!!probe.error, `league_clubs missing — run migration 118 (${probe.error?.message})`);

  const stamp = Date.now();
  const clubName = `QA Aff Club ${stamp}`;
  const leagueName = `QA Aff League ${stamp}`;

  const { data: club, error: clubError } = await admin
    .from('clubs')
    .insert({ name: clubName, owner_profile_id: userA.id })
    .select()
    .single();
  expect(clubError, clubError?.message).toBeNull();
  const clubId = club!.id as string;
  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(leagueError, leagueError?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ club_id: clubId, profile_id: userA.id, role: 'owner' });
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: userB.id, role: 'owner' });

  try {
    // B (league owner) invites the club from the league page.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/league/${leagueId}`);
      const inviteBox = pageB.getByPlaceholder('Search clubs to affiliate…');
      await expect(inviteBox).toBeVisible({ timeout: 15_000 });
      // 143: pick a non-default type BEFORE clicking the candidate (the
      // click POSTs immediately).
      await pageB.getByLabel('Affiliation type').selectOption('member_of');
      await inviteBox.fill(clubName);
      await pageB.getByRole('button', { name: new RegExp(clubName) }).click();
      await expect(pageB.getByRole('button', { name: 'Withdraw' })).toBeVisible({ timeout: 15_000 });
      // The pending row carries the type chip (league-side label).
      await expect(pageB.getByText('Member club', { exact: true })).toBeVisible();
    } finally {
      await ctxB.close();
    }

    // Matrix edges via the API, while pending:
    const apiB = await apiAs('state-b.json');
    try {
      // Initiator cannot accept its own invite.
      const selfAccept = await apiB.patch(`/api/leagues/${leagueId}/clubs`, {
        data: { clubId, action: 'accept' },
      });
      expect(selfAccept.status(), await readErrorBody(selfAccept)).toBe(403);
      // Duplicate invite → 409 (the PK is the authority).
      const dup = await apiB.post(`/api/leagues/${leagueId}/clubs`, { data: { clubId } });
      expect(dup.status(), await readErrorBody(dup)).toBe(409);
    } finally {
      await apiB.dispose();
    }
    // A is no league manager: POST on the league route → 403.
    const apiA = await apiAs('state.json');
    try {
      const notManager = await apiA.post(`/api/leagues/${leagueId}/clubs`, { data: { clubId } });
      expect(notManager.status(), await readErrorBody(notManager)).toBe(403);
    } finally {
      await apiA.dispose();
    }

    // A (club owner, the default page context) accepts from the club page.
    await page.goto(`/club/${clubId}`);
    await expect(page.getByText(leagueName)).toBeVisible({ timeout: 15_000 });
    // Incoming row shows the club-side type label.
    await expect(page.getByText('Member of', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('button', { name: 'End affiliation' })).toBeVisible({ timeout: 15_000 });
    // The chip survives onto the active row.
    await expect(page.getByText('Member of', { exact: true })).toBeVisible();

    // Server truth both ways.
    const { data: row } = await admin
      .from('league_clubs')
      .select('status, initiated_by, affiliation_type')
      .eq('league_id', leagueId)
      .eq('club_id', clubId)
      .maybeSingle();
    expect(row?.status).toBe('active');
    expect(row?.initiated_by).toBe('league');
    expect(row?.affiliation_type).toBe('member_of');

    // Notifications: invite reached A (club owner), acceptance reached B.
    const { data: inviteNotif } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', userA.id)
      .eq('type', 'affiliation_invite')
      .contains('metadata', { affiliation_type: 'member_of' });
    expect((inviteNotif ?? []).length).toBeGreaterThan(0);
    const { data: updateNotif } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', userB.id)
      .eq('type', 'affiliation_update');
    expect((updateNotif ?? []).length).toBeGreaterThan(0);

    // The league page cross-lists the club.
    const ctxB2 = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB2.newPage();
      await pageB.goto(`/league/${leagueId}`);
      await expect(pageB.getByText(clubName).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctxB2.close();
    }
  } finally {
    await admin.from('notifications').delete().eq('type', 'affiliation_invite').eq('user_id', userA.id);
    await admin.from('notifications').delete().eq('type', 'affiliation_update').eq('user_id', userB.id);
    await admin.from('league_clubs').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
