import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 8 P6 — the season wrap. Once every windowed week has closed, the
// standings carry "Season complete" (champion, runner-up, most wins, best
// round) on the site, the twin and the console; the console announces it
// ONCE through the announce rails (bells to members, a guardian copy, the
// site notice) — a repeat 409s. An open week → no summary, no button.

const stamp = Math.random().toString(36).slice(2, 8);
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('season wrap: closed weeks → summary on site + console; announce once (bells, guardian copy, notice), repeat 409; open week → none; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  await resetRateBucket(admin, 'org-competitions', owner.id);
  await resetRateBucket(admin, 'org-announce', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Wrap Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(alpha.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-wrap-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' }] : []),
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin.from('venues').insert({ club_id: clubId, name: `QA Wrap Links ${stamp}` }).select('id').single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Wrap League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_points',
      config: { golf: { pick: 'first', points: 'pga', score: 'gross' } },
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
    ])
    .select('id, profile_id');
  const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const base = `/api/clubs/${clubId}/competitions`;
  const announcementIds: string[] = [];
  try {
    const participantOf = async (contestId: string) => {
      const { data } = await admin.from('contest_participants').select('id, entry_id').eq('contest_id', contestId);
      return new Map((data ?? []).map(p => [p.entry_id as string, p.id as string]));
    };
    const post = async (contestId: string, scores: Array<[string, number]>) => {
      const parts = await participantOf(contestId);
      const res = await ownerApi.post(`${base}/${competitionId}/results`, {
        data: { contestId, results: scores.map(([pid, gross]) => ({ participantId: parts.get(entryOf.get(pid)!), score: gross, payload: { gross, holes: 18 } })) },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    };
    const addWeek = async (round: string, from: number, to: number) => {
      const res = await ownerApi.post(`${base}/${competitionId}/contests`, {
        data: { competitionId, round, venueId: venue!.id, holes: 18, playFrom: isoDay(from), playTo: isoDay(to) },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      return ((await res.json()).contest as { id: string }).id;
    };
    // Two closed weeks: the owner wins week 1 (78 v 82), alpha week 2 (76 v 85).
    const w1 = await addWeek('Week 1', -20, -14);
    await post(w1, [[owner.id, 78], [alpha.id, 82]]);
    const w2 = await addWeek('Week 2', -13, -7);
    await post(w2, [[owner.id, 85], [alpha.id, 76]]);
    // Totals: owner 100 + 75 = 175, alpha 75 + 100 = 175 → a dead heat: rank 1 both.
    // Break it: a third closed week the owner wins.
    const w3 = await addWeek('Week 3', -6, -1);
    await post(w3, [[owner.id, 79], [alpha.id, 80]]);

    // The site: publish → "Season complete".
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const pub = await anon.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
    const payload = (await pub.json()) as {
      competitions: { id: string; seasonSummary?: { weeksPlayed: number; champion: { name: string; points: number | null }; runnerUp: { name: string } | null; mostWins: { name: string; wins: number } | null; bestRound: { gross: number; round: string | null } | null } }[];
    };
    const summary = payload.competitions.find(c => c.id === competitionId)!.seasonSummary!;
    expect(summary.weeksPlayed).toBe(3);
    expect(summary.champion.points).toBe(275);
    expect(summary.mostWins).toMatchObject({ wins: 2 });
    expect(summary.bestRound).toEqual({ name: summary.runnerUp!.name, gross: 76, round: 'Week 2' });
    let siteHtml = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}/standings`); siteHtml = r.ok() ? await r.text() : ''; return r.status(); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    expect(siteHtml).toContain('Season complete');
    expect(siteHtml).toContain('wins with 275 pts');
    expect(siteHtml).toContain('Best round');

    // The console: the card + the button → announce once.
    res = await ownerApi.get(`${base}/${competitionId}/season-announce`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()) as { announcedAt: string | null }).announcedAt).toBeNull();
    res = await alphaApi.post(`${base}/${competitionId}/season-announce`);
    expect(res.status()).toBe(403);
    res = await ownerApi.post(`${base}/${competitionId}/season-announce`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const out = (await res.json()) as { announcementId: string; sent: number; guardians: number; siteNotice: boolean };
    announcementIds.push(out.announcementId);
    expect(out.sent).toBe(childId ? 2 : 1); // alpha (+ the child), never the sender
    expect(out.guardians).toBe(childId ? 1 : 0);
    expect(out.siteNotice).toBe(true);
    const { data: rows } = await admin.from('notifications').select('user_id, title, message, metadata').contains('metadata', { announcement_id: out.announcementId });
    const memberRows = rows!.filter(r => !(r.metadata as { profile_id?: string }).profile_id);
    expect(memberRows.map(r => r.user_id).sort()).toEqual([alpha.id, ...(childId ? [childId] : [])].sort());
    expect(memberRows[0].title).toContain(`Wrap League ${stamp}: ${summary.champion.name} wins the season`);
    expect(memberRows[0].message).toContain('with 275 pts over 3 weeks');
    expect(memberRows.every(r => (r.metadata as { season_competition_id?: string }).season_competition_id === competitionId)).toBe(true);
    // A repeat 409s with the date; the GET reports it.
    res = await ownerApi.post(`${base}/${competitionId}/season-announce`);
    expect(res.status()).toBe(409);
    res = await ownerApi.get(`${base}/${competitionId}/season-announce`);
    expect(((await res.json()) as { announcedAt: string | null }).announcedAt).toBeTruthy();
    // The site notice.
    await expect
      .poll(async () => (await (await anon.request.get(`/org/${subdomain}`)).text()).includes('wins the season'), { timeout: 30_000, intervals: [1500, 3000] })
      .toBe(true);

    // The console at 375px: the card, the button reads "Announced".
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.locator('[data-season-complete]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: /^Announced \d{4}-\d{2}-\d{2}$/ })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }

    // An open week → no summary, and the POST refuses.
    await addWeek('Week 4', -1, 5);
    const again = (await (await anon.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`)).json()) as { competitions: { id: string; seasonSummary?: unknown }[] };
    expect(again.competitions.find(c => c.id === competitionId)!.seasonSummary).toBeUndefined();
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    for (const id of announcementIds) await admin.from('notifications').delete().contains('metadata', { announcement_id: id });
    await admin.from('clubs').delete().eq('id', clubId);
    if (childId) await deleteQaUser(childId);
  }
});
