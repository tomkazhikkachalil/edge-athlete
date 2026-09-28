import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports-team website program, G5 (Sep 28 2026): a game's status change
// purges the org sites that show it. The division page (ISR, 300 s) lists a
// sport-event game between its teams; the organizer cancels it; within a
// few polls — far inside the 300 s window — the page no longer lists it.

test('a sport-event game’s status change purges the site: cancelled leaves the division page at once', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_teams').select('side').limit(1);
  test.skip(!!probe.error, `sport_event_teams missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'sport-event', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Gameday Fresh ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  let eventId: string | null = null;
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    await admin.from('org_site_modules').update({ enabled: true }).eq('site_id', siteId).in('module_key', ['teams', 'divisions']);
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `GF ${stamp}` }).select('id').single();
    const { data: division } = await admin.from('divisions').insert({ org_id: league.id, season_id: season!.id, name: `U15 ${stamp}`, sport_key: 'ice_hockey' }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Kings ${stamp}` }, { org_id: league.id, name: `Aces ${stamp}` }]).select('id, name');
    const kings = teams!.find(t => (t.name as string).startsWith('Kings'))!.id as string;
    const aces = teams!.find(t => (t.name as string).startsWith('Aces'))!.id as string;
    await admin.from('team_entries').insert([{ team_id: kings, division_id: division!.id }, { team_id: aces, division_id: division!.id }]);
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const { data: ev, error: evError } = await admin
      .from('sport_events')
      .insert({ host_profile_id: owner.id, org_id: league.id, sport_key: 'ice_hockey', shape: 'game', name: `Cup tie ${stamp}`, visibility: 'public', status: 'open', format_config: { game: { side_names: [`Kings ${stamp}`, `Aces ${stamp}`] } } })
      .select('id')
      .single();
    expect(evError, evError?.message).toBeNull();
    eventId = ev!.id as string;
    await admin.from('sport_event_rounds').insert({ sport_event_id: eventId, sequence: 1, scheduled_on: soon.toISOString().slice(0, 10), starts_at: soon.toISOString(), course_name: `QA Rink ${stamp}` });
    await admin.from('sport_event_teams').insert([{ sport_event_id: eventId, side: 1, team_id: kings }, { sport_event_id: eventId, side: 2, team_id: aces }]);

    const probeBase = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probeBase.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const url = `${base}/divisions/${division!.id}`;
    await settleBody(anon.request, url, `Cup tie ${stamp}`, true, 12);
    // Cached now: a second read still lists it.
    expect(await (await anon.request.get(url)).text()).toContain(`Cup tie ${stamp}`);

    res = await ownerApi.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The purge: gone within ~30 s, never the 300 s window.
    await settleBody(anon.request, url, `Cup tie ${stamp}`, false, 12);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    if (eventId) await admin.from('sport_events').delete().eq('id', eventId);
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
