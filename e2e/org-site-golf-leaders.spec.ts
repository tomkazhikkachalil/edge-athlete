import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaChild,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody,
  resetRateBucket,
} from './helpers/qa-user';

// Golf sites, part 5 (phase 6e S5): golf leaders. The leaders module has
// no stat lines for golf; a golf LEADERBOARD's boards come from its
// results instead — low gross by nine and by eighteen, low net on a net
// league, most rounds, best week — completed rounds only, names masked,
// supervised athletes omitted. A golf FIXTURE still degrades honestly.

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 8
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle) === shouldContain) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

test('golf leaders: low gross 9/18, low net, most rounds, best week from results; child omitted; home teaser; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // "Edge Bravo"
  const alpha = loadQaUser('user.json'); // "Edge Alpha"
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const stamp = Date.now();
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Leaders League ${stamp}`, sport_key: 'golf', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(owner.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-leaders-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ league_id: leagueId, profile_id: childId, role: 'member', kind: 'follow' }] : []),
  ]);
  const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: `2026 ${stamp}` }).select().single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Net League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_net',
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  const { data: entries } = await admin
    .from('competition_entries')
    .insert([
      { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
      { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
      ...(childId ? [{ competition_id: competitionId, profile_id: childId, status: 'approved' }] : []),
    ])
    .select('id, profile_id');
  const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));
  // Three COMPLETED rounds (two nines, one eighteen) and one still-open round
  // whose results must not count.
  const { data: contests } = await admin
    .from('contests')
    .insert([
      { competition_id: competitionId, round: 'Week 1', holes: 9, play_from: '2026-08-03', play_to: '2026-08-09', status: 'completed' },
      { competition_id: competitionId, round: 'Week 2', holes: 9, play_from: '2026-08-10', play_to: '2026-08-16', status: 'completed' },
      { competition_id: competitionId, round: 'Finale', holes: 18, play_from: '2026-08-17', play_to: '2026-08-23', status: 'completed' },
      { competition_id: competitionId, round: 'Week 4', holes: 9, play_from: '2026-09-01', play_to: '2026-09-07', status: 'scheduled' },
    ])
    .select('id, round');
  const contestOf = new Map(contests!.map(c => [c.round as string, c.id as string]));
  const participantRows = contests!.flatMap(c => [...entryOf.values()].map(entryId => ({ contest_id: c.id, entry_id: entryId, side: null })));
  const { data: participants } = await admin.from('contest_participants').insert(participantRows).select('id, contest_id, entry_id');
  const pid = (round: string, profileId: string) =>
    participants!.find(p => p.contest_id === contestOf.get(round) && p.entry_id === entryOf.get(profileId))!.id as string;
  const result = (round: string, profileId: string, gross: number, net: number, holes: number) => ({
    contest_id: contestOf.get(round)!,
    participant_id: pid(round, profileId),
    score: net,
    payload: { gross, net, holes, tee: 'white' },
    provenance: 'league_verified',
    entered_by: profileId,
  });
  await admin.from('contest_results').insert([
    result('Week 1', owner.id, 41, 36, 9),
    result('Week 1', alpha.id, 38, 37, 9),
    result('Week 2', owner.id, 39, 34, 9),
    result('Finale', owner.id, 80, 70, 18),
    // The open round: a 30 that must not appear anywhere.
    result('Week 4', alpha.id, 33, 30, 9),
    ...(childId ? [result('Week 1', childId, 35, 30, 9)] : []),
  ]);

  const ownerApi = await apiAs('state-b.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'leaders', enabled: true } });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const canonicalProbe = await anonCtx.request.get(`/org/${site.subdomain}`, { maxRedirects: 0 });
    const sitePath = canonicalProbe.status() === 301 ? `/${site.subdomain}` : `/org/${site.subdomain}`;

    const leaders = await settleBody(anonCtx.request, `${sitePath}/leaders`, 'Low gross (9 holes)', true, 12);
    expect(leaders).toContain('Low gross (9 holes)');
    expect(leaders).toContain('Low gross (18 holes)');
    expect(leaders).toContain('Low net (9 holes)');
    expect(leaders).toContain('Most rounds');
    expect(leaders).toContain('Best week');
    expect(leaders).toContain('>Gross<');
    expect(leaders).toContain('>Net<');
    expect(leaders).toContain('>Rounds<');
    // Low gross 9: Alpha's 38 before the owner's 39 (the 41 is not their best).
    const gross9 = leaders.slice(leaders.indexOf('Low gross (9 holes)'), leaders.indexOf('Low gross (18 holes)'));
    expect(gross9.indexOf('>38<')).toBeGreaterThan(-1);
    expect(gross9.indexOf('>38<')).toBeLessThan(gross9.indexOf('>39<'));
    expect(gross9).not.toContain('>41<');
    // The open round's 33/30 never appears; the child never appears.
    expect(leaders).not.toContain('>33<');
    expect(leaders).not.toContain('Casey');
    // Best week: the owner's net 34 in Week 2, with the round as the note.
    const best = leaders.slice(leaders.indexOf('Best week'));
    expect(best).toContain('>34<');
    expect(best).toContain('Week 2 · 2026-08-10');
    // Most rounds: the owner has 3.
    const most = leaders.slice(leaders.indexOf('Most rounds'), leaders.indexOf('Best week'));
    expect(most).toContain('>3<');
    expect(leaders).not.toContain('Stat leaders aren’t available for');

    // The home teaser shows the first board.
    const home = await settleBody(anonCtx.request, sitePath, 'Low gross (9 holes)', true, 12);
    expect(home).toContain('All leaders');

    const page = await anonCtx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${sitePath}/leaders`);
    await expect(page.getByRole('heading', { name: 'Stat leaders', level: 1 })).toBeVisible({ timeout: 15_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.close();
  } finally {
    await ownerApi.dispose();
    await anonCtx.close();
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
    if (childId) await deleteQaUser(childId);
  }
});
