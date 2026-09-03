import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 8 P5 — the console side of the race. The competition page draws
// the points race and, on an open round, who has not posted yet with a
// one-click reminder: ONE bell per unposted entrant (a guardian copy for a
// supervised member), nothing for the posted one, nothing new on a repeat;
// keyed apart from the cron's window-closing reminder so both can fire.
// The member's "Your week" carries the season standing. 375px console.

const stamp = Math.random().toString(36).slice(2, 8);
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('console race + reminder: not-yet-posted list, one bell each (guardian copy), repeat = 0, cron keyed apart; member standing; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json'); // the manager, also an entrant
  const alpha = loadQaUser('user.json'); // an entrant who has not posted; guardian of the child
  await resetRateBucket(admin, 'org-competitions', owner.id);
  await resetRateBucket(admin, 'org-announce', owner.id);
  const bellProbe = await admin
    .from('notifications')
    .insert({ user_id: owner.id, type: 'golf_league_window_closing', title: 'probe', is_read: true, metadata: { probe: true } })
    .select('id')
    .single();
  const bellsLive = !bellProbe.error;
  if (bellProbe.data) await admin.from('notifications').delete().eq('id', bellProbe.data.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Nudge Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(alpha.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-nudge-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' }] : []),
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin.from('venues').insert({ club_id: clubId, name: `QA Nudge Links ${stamp}` }).select('id').single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Nudge League ${stamp}`,
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
      ...(childId ? [{ competition_id: competitionId, profile_id: childId, status: 'approved' }] : []),
    ])
    .select('id, profile_id');
  const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const base = `/api/clubs/${clubId}/competitions`;
  const contestIds: string[] = [];
  try {
    const participantOf = async (contestId: string) => {
      const { data } = await admin.from('contest_participants').select('id, entry_id').eq('contest_id', contestId);
      return new Map((data ?? []).map(p => [p.entry_id as string, p.id as string]));
    };
    // A completed week (everyone posted) so the race and the standings exist…
    let res = await ownerApi.post(`${base}/${competitionId}/contests`, {
      data: { competitionId, round: 'Week 1', venueId: venue!.id, holes: 18, playFrom: isoDay(-10), playTo: isoDay(-4) },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    contestIds.push(((await res.json()).contest as { id: string }).id);
    let parts = await participantOf(contestIds[0]);
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: {
        contestId: contestIds[0],
        results: [
          { participantId: parts.get(entryOf.get(owner.id)!), score: 78, payload: { gross: 78, holes: 18 } },
          { participantId: parts.get(entryOf.get(alpha.id)!), score: 82, payload: { gross: 82, holes: 18 } },
          ...(childId ? [{ participantId: parts.get(entryOf.get(childId)!), score: 90, payload: { gross: 90, holes: 18 } }] : []),
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // …and an OPEN week where only the owner has posted.
    res = await ownerApi.post(`${base}/${competitionId}/contests`, {
      data: { competitionId, round: 'Week 2', venueId: venue!.id, holes: 18, playFrom: isoDay(-3), playTo: isoDay(3) },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    contestIds.push(((await res.json()).contest as { id: string }).id);
    parts = await participantOf(contestIds[1]);
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: { contestId: contestIds[1], results: [{ participantId: parts.get(entryOf.get(owner.id)!), score: 80, payload: { gross: 80, holes: 18 } }] },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The reminder: alpha (+ the child) get ONE bell each; the owner none; the
    // child's is copied to the guardian (alpha) as well.
    const bells = async () =>
      (
        await admin
          .from('notifications')
          .select('user_id, title, metadata')
          .eq('type', 'golf_league_window_closing')
          .contains('metadata', { contest_id: contestIds[1] })
      ).data ?? [];
    res = await ownerApi.post(`${base}/${competitionId}/golf-sync/nudge`, { data: { contestId: contestIds[1] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const report = (await res.json()) as { nudged: number; unposted: number };
    expect(report.unposted).toBe(childId ? 2 : 1);
    if (bellsLive) {
      expect(report.nudged).toBe(childId ? 2 : 1);
      const sent = await bells();
      const own = sent.filter(n => !(n.metadata as { profile_id?: string }).profile_id);
      expect(own.map(n => n.user_id).sort()).toEqual([alpha.id, ...(childId ? [childId] : [])].sort());
      expect(own[0].title).toContain('Week 2');
      expect(own[0].title).toContain('is open — post your round');
      expect(own.every(n => (n.metadata as { golf_league?: string }).golf_league === 'nudge')).toBe(true);
      if (childId) {
        const guardianCopy = sent.filter(n => n.user_id === alpha.id && (n.metadata as { profile_id?: string }).profile_id === childId);
        expect(guardianCopy).toHaveLength(1);
      }
      // A repeat sends nothing new.
      res = await ownerApi.post(`${base}/${competitionId}/golf-sync/nudge`, { data: { contestId: contestIds[1] } });
      expect(res.status()).toBe(200);
      expect(((await res.json()) as { nudged: number }).nudged).toBe(0);
      expect((await bells()).length).toBe(sent.length);
      // The cron's own reminder is keyed apart: a 'closing' bell would still
      // be planned for alpha (the nudge does not count as one).
      const { data: closingSent } = await admin
        .from('notifications')
        .select('user_id')
        .eq('type', 'golf_league_window_closing')
        .contains('metadata', { golf_league: 'closing', contest_id: contestIds[1] });
      expect(closingSent ?? []).toHaveLength(0);
    }
    // A member cannot nudge.
    res = await alphaApi.post(`${base}/${competitionId}/golf-sync/nudge`, { data: { contestId: contestIds[1] } });
    expect(res.status()).toBe(403);

    // The member's "Your week" carries the season standing.
    res = await alphaApi.get(`/api/clubs/${clubId}/golf/mine`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const mine = (await res.json()) as { entries: { competitionId: string; standing: { rank: number; of: number; points: number | null } | null }[] };
    const myEntry = mine.entries.find(e => e.competitionId === competitionId)!;
    expect(myEntry.standing).toEqual({ rank: 2, of: childId ? 3 : 2, points: 75 });

    // The console at 375px: the race, the not-yet-posted list, the button.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: 'Points race', level: 3 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('columnheader', { name: 'W1' })).toBeVisible();
      const notPosted = page.locator('[data-not-posted]');
      await expect(notPosted).toHaveCount(1);
      await expect(notPosted).toContainText('Not yet posted:');
      await expect(notPosted).not.toContainText('Edge Bravo'); // the owner has posted
      await expect(page.getByRole('button', { name: 'Send a reminder' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      // The member page shows the standing.
      const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 812 } });
      try {
        const mp = await memberCtx.newPage();
        await mp.goto(`/club/${clubId}`);
        await expect(mp.locator('[data-standing]').first()).toContainText('Season: 2nd of', { timeout: 20_000 });
      } finally {
        await memberCtx.close();
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    if (contestIds.length) await admin.from('notifications').delete().in('metadata->>contest_id', contestIds);
    await admin.from('clubs').delete().eq('id', clubId);
    if (childId) await deleteQaUser(childId);
  }
});
