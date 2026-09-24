import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, loadQaUser } from './helpers/qa-user';

type View = { event: { id: string; status: string; game?: { side_names: [string, string]; side_team_ids?: [string, string] } | null }; participants: Array<{ id: string; profile_id: string; status: string; playing: boolean; role: string }>; groups: Array<{ sport_event_round_id: string; members: Array<{ participant_id: string; side?: 1 | 2 | null }> }> };

/**
 * Events + formats leftovers, PR 5 — an org's teams pre-fill a game's
 * sides, at phone width on Chromium and WebKit. A (the mobile session's
 * user) owns a hockey league with two teams and their rosters (B on the
 * Reds, C on the Blues). The wizard: hockey, a game, hosted for the
 * league, both teams picked → the side names fill from the teams → Publish
 * → the Sides line; the view: B and C accepted and playing, one group with
 * the sides sent, the team ids on the game config.
 */
test('team sides: two org teams picked in the wizard → the rosters become the sides @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const owner = loadQaUser('user.json');
  const b = loadQaUser('user-b.json');
  const c = loadQaUser('user-c.json');
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('shape').limit(1);
  test.skip(!!probe.error, 'sport_events.shape missing — run migration 215');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Sides League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, visibility: 'public' });
  const leagueId = league.id;
  let eventId: string | null = null;
  try {
    const { data: teams } = await admin.from('teams').insert([{ org_id: leagueId, name: `Reds ${stamp}` }, { org_id: leagueId, name: `Blues ${stamp}` }]).select('id, name');
    const reds = teams!.find(t => (t.name as string).startsWith('Reds'))!.id as string;
    const blues = teams!.find(t => (t.name as string).startsWith('Blues'))!.id as string;
    const roster = (profileId: string, teamId: string) => [
      { org_id: leagueId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
      { org_id: leagueId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: teamId },
    ];
    const { error: memberError } = await admin.from('memberships').insert([
      { org_id: leagueId, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null },
      ...roster(b.id, reds), ...roster(c.id, blues),
    ]);
    expect(memberError, memberError?.message).toBeNull();

    await page.goto('/sports/events/new');
    await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-event-wizard-name]').fill(`QA Sides Game ${stamp}`);
    await page.getByRole('radio', { name: 'Ice Hockey' }).check();
    await expect(page.getByRole('radio', { name: 'A game' })).toBeChecked();
    await page.getByLabel(/Hosted for/).selectOption(`league:${leagueId}`);
    await page.locator('[data-event-wizard-next]').click();
    await expect(page.getByRole('heading', { name: 'The game' })).toBeVisible();
    await page.locator('[data-event-wizard-date]').fill('2030-06-01');
    await page.locator('[data-wizard-place]').fill(`QA Rink ${stamp}`);
    await page.locator('[data-wizard-time]').fill('19:30');
    await page.locator('[data-event-wizard-next]').click();

    // The format step: the two team picks fill the names; one pick alone is refused.
    await expect(page.locator('[data-event-wizard="format"]')).toBeVisible();
    await expect(page.locator('[data-wizard-side-team="1"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-wizard-side-team="1"]').selectOption(reds);
    await expect(page.locator('[data-wizard-side="1"]')).toHaveValue(`Reds ${stamp}`);
    await page.locator('[data-event-wizard-next]').click();
    await expect(page.locator('[data-event-wizard-refusal]')).toHaveText(/both teams/);
    await page.locator('[data-wizard-side-team="2"]').selectOption(blues);
    await expect(page.locator('[data-wizard-side="2"]')).toHaveValue(`Blues ${stamp}`);
    await page.locator('[data-event-wizard-next]').click();
    await expect(page.locator('[data-event-wizard="review"]')).toBeVisible();
    await expect(page.getByText(`Reds ${stamp} vs Blues ${stamp}`)).toBeVisible();
    await page.locator('[data-event-wizard-publish]').click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    eventId = page.url().split('/').pop()!;
    await expect(page.locator('[data-event-sides-line]')).toHaveText(`Reds ${stamp} vs Blues ${stamp}`, { timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at phone width').toBeLessThanOrEqual(page.viewportSize()!.width);

    // The rosters are the sides: B and C accepted + playing, one group with the sides sent, the team ids on the config.
    const view = (await (await page.request.get(`/api/sport-events/${eventId}`)).json()) as View;
    expect(view.event.status).toBe('open');
    expect(view.event.game?.side_team_ids).toEqual([reds, blues]);
    const idOf = (profileId: string) => view.participants.find(p => p.profile_id === profileId)!;
    expect(idOf(b.id)).toMatchObject({ status: 'accepted', playing: true, role: 'participant' });
    expect(idOf(c.id)).toMatchObject({ status: 'accepted', playing: true, role: 'participant' });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].members.find(m => m.participant_id === idOf(b.id).id)?.side).toBe(1);
    expect(view.groups[0].members.find(m => m.participant_id === idOf(c.id).id)?.side).toBe(2);
  } finally {
    if (eventId) {
      await page.request.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } });
      await page.request.delete(`/api/sport-events/${eventId}`);
    }
    await deleteQaOrgs(admin, [leagueId]);
  }
});
