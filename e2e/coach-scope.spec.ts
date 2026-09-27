import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs, rosterSeasonId } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Teams & divisions program, PR 10 (Sep 27 2026): the coach view. C holds a
// staff grant on ONE team (Blazers, section Teams). C's console opens on the
// focused view — a card for Blazers only — where C adds a rostered member to
// Blazers and puts a practice on Blazers' calendar. The sibling team is not
// C's: its roster refuses C, and so does its calendar and an org-level
// event. 390px: no sideways scroll. @mobile

test('coach view: a team grant lands on a focused console that runs its roster and calendar — and nothing else @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const coach = loadQaUser('user-c.json');
  const player = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-structure', coach.id);
  const stamp = Date.now();
  const name = `QA Coach Club ${stamp}`;
  const club = await createQaOrg(admin, 'club', { name, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const coachApi = await apiAs('state-c.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-c.json', viewport: { width: 390, height: 844 } });
  try {
    await admin.from('memberships').insert([
      { org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' },
      { org_id: club.id, profile_id: player.id, kind: 'follow', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: player.id, kind: 'roster', role: 'member', status: 'active' },
    ]);
    await rosterSeasonId(admin, club.id);
    const { data: teams } = await admin.from('teams').insert([{ org_id: club.id, name: `Blazers ${stamp}` }, { org_id: club.id, name: `Comets ${stamp}` }]).select('id, name');
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    const { error: grantError } = await admin.from('memberships').insert({ org_id: club.id, profile_id: coach.id, kind: 'staff', role: 'staff', status: 'active', scope_type: 'team', scope_id: blazers, sections: ['teams'] });
    expect(grantError, grantError?.message).toBeNull();

    // The landing.
    const caps = await (await coachApi.get(`/api/clubs/${club.id}/capabilities`)).json();
    expect(caps.landing).toBe('scoped');

    // The focused console: Blazers only.
    const page = await ctx.newPage();
    await page.goto(`/app/org/club/${club.id}`);
    await expect(page.locator('[data-scoped-console]')).toBeVisible({ timeout: 30_000 });
    const card = page.locator(`[data-scoped-team="${blazers}"]`);
    await expect(card).toBeVisible();
    await expect(page.locator(`[data-scoped-team="${comets}"]`)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Teams', exact: true })).toHaveCount(0); // no org-wide Teams section

    // Roster: add the rostered member.
    await card.getByRole('button', { name: 'Roster' }).click();
    const panel = page.locator(`[data-team-roster="${blazers}"]`);
    await expect(panel.locator('[data-team-roster-candidates]')).toBeVisible({ timeout: 20_000 });
    await panel.locator('[data-team-roster-candidates] button', { hasText: 'Add' }).first().click();
    await expect(panel.locator(`[data-team-roster-player="${player.id}"]`)).toBeVisible({ timeout: 20_000 });

    // A practice on Blazers' calendar.
    await card.getByRole('button', { name: 'Add an event' }).click();
    const form = page.locator(`[data-scoped-event="${blazers}"]`);
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await form.getByLabel('Event title').fill(`Coach practice ${stamp}`);
    await form.getByLabel('Date').fill(day);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await form.getByRole('button', { name: 'Add event' }).click();
    await expect(form).toHaveCount(0, { timeout: 20_000 });
    const { data: events } = await admin.from('events').select('team_id, category').eq('title', `Coach practice ${stamp}`);
    expect(events).toEqual([{ team_id: blazers, category: 'practice' }]);

    // Nothing beyond the grant.
    let res = await coachApi.post(`/api/clubs/${club.id}/teams/${comets}/roster`, { data: { profileId: player.id } });
    expect(res.status(), await readErrorBody(res)).toBe(403);
    const at = new Date(Date.now() + 4 * 86_400_000);
    const event = (scope: Record<string, string>) => ({ title: `Not mine ${stamp}`, starts_at: at.toISOString(), ends_at: new Date(at.getTime() + 3_600_000).toISOString(), timezone: 'UTC', all_day: false, ...scope });
    res = await coachApi.post('/api/calendar/events', { data: event({ team_id: comets }) });
    expect(res.status(), await readErrorBody(res)).toBe(403);
    res = await coachApi.post('/api/calendar/events', { data: event({ club_id: club.id }) });
    expect(res.status(), await readErrorBody(res)).toBe(403);
  } finally {
    await admin.from('events').delete().in('title', [`Coach practice ${stamp}`, `Not mine ${stamp}`]);
    await ctx.close();
    await coachApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
  }
});
