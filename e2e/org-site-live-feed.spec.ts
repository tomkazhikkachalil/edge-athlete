import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { pollUntil } from './helpers/isr';

// Sports-team website program, V1 (Sep 28 2026): a site's live scoreboard
// feed. Anonymous and viewer-independent: a live game between the league's
// teams shows with its score and a 15 s poll hint, edge-cacheable (s-maxage
// 10); a new score reaches the feed within its short cache; a query string is
// a 400; an unknown or private site is a 404 — every non-200 no-store; the
// payload carries names and links, never a team or profile id.

test('live feed: a live game’s score, cacheable for everyone; query strings refused; private and unknown sites 404', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_teams').select('side').limit(1);
  test.skip(!!probe.error, `sport_event_teams missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Live Feed ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  let eventId: string | null = null;
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'set_module', moduleKey: 'schedule', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Hawks ${stamp}` }, { org_id: league.id, name: `Storm ${stamp}` }]).select('id, name');
    const hawks = teams!.find(t => (t.name as string).startsWith('Hawks'))!.id as string;
    const storm = teams!.find(t => (t.name as string).startsWith('Storm'))!.id as string;
    const started = new Date(Date.now() - 30 * 60_000);
    const { data: ev, error: evError } = await admin
      .from('sport_events')
      .insert({ host_profile_id: owner.id, org_id: league.id, sport_key: 'ice_hockey', shape: 'game', name: `Live night ${stamp}`, visibility: 'public', status: 'live', format_config: { game: { side_names: [`Hawks ${stamp}`, `Storm ${stamp}`] } } })
      .select('id')
      .single();
    expect(evError, evError?.message).toBeNull();
    eventId = ev!.id as string;
    const { data: round, error: roundError } = await admin
      .from('sport_event_rounds')
      .insert({ sport_event_id: eventId, sequence: 1, scheduled_on: started.toISOString().slice(0, 10), starts_at: started.toISOString(), course_name: `QA Rink ${stamp}`, status: 'live', side1_score: 1, side2_score: 0 })
      .select('id')
      .single();
    expect(roundError, roundError?.message).toBeNull();
    await admin.from('sport_event_teams').insert([{ sport_event_id: eventId, side: 1, team_id: hawks }, { sport_event_id: eventId, side: 2, team_id: storm }]);

    const url = `/api/public/org-sites/${subdomain}/live`;
    type Feed = { v: number; pollMs: number; games: { id: string; state: string; home: { name: string; score: number | null } | null; away: { name: string; score: number | null } | null }[] };
    const liveGame = (f: Feed) => f.games.find(g => g.id === `event:${eventId}`);
    // Anonymous: the live game with its score, a 15 s hint, edge-cacheable.
    const first = await pollUntil(
      async () => {
        const r = await anon.request.get(url);
        return { status: r.status(), cache: r.headers()['cache-control'] ?? '', body: r.status() === 200 ? ((await r.json()) as Feed) : null };
      },
      v => v.status === 200 && !!v.body && !!liveGame(v.body),
      { attempts: 12, label: 'the live game on the feed' }
    );
    expect(first.cache).toContain('s-maxage=10');
    expect(first.body!.pollMs).toBe(15_000);
    expect(liveGame(first.body!)).toMatchObject({ state: 'live', home: { name: `Hawks ${stamp}`, score: 1 }, away: { name: `Storm ${stamp}`, score: 0 } });
    const raw = JSON.stringify(first.body);
    expect(raw).not.toContain(hawks);
    expect(raw).not.toContain(storm);
    expect(raw).not.toContain(owner.id);

    // A new score reaches the feed within its short cache.
    await admin.from('sport_event_rounds').update({ side1_score: 2, side2_score: 2 }).eq('id', round!.id);
    await pollUntil(
      async () => ((await (await anon.request.get(url)).json()) as Feed),
      f => liveGame(f)?.home?.score === 2 && liveGame(f)?.away?.score === 2,
      { attempts: 15, delayMs: 3000, label: 'the new score on the feed' }
    );

    // A query string is refused (it would split the cache); every non-200 is no-store.
    res = await anon.request.get(`${url}?bust=1`);
    expect(res.status()).toBe(400);
    expect(res.headers()['cache-control']).toBe('no-store');
    res = await anon.request.get(`/api/public/org-sites/qa-no-such-site-${stamp}/live`);
    expect(res.status()).toBe(404);
    expect(res.headers()['cache-control']).toBe('no-store');

    // A private league's scoreboard is members-only: the feed is a 404.
    res = await ownerApi.patch(`/api/leagues/${league.id}`, { data: { visibility: 'private' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await pollUntil(async () => (await anon.request.get(url)).status(), s => s === 404, { attempts: 15, delayMs: 3000, label: 'private → 404' });
  } finally {
    await anon.close();
    await ownerApi.dispose();
    if (eventId) await admin.from('sport_events').delete().eq('id', eventId);
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
