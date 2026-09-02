import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The leaderboard format (phase 2, round 5 — the adapter-seam proof): a
// golf club runs a 2-round club championship on THE SAME TABLES. Athlete
// entrants resolve through ROSTER memberships (§8 invariant 3); a round
// mints participants for every approved entrant; standings sum totals
// ASCENDING (stroke_total) with the adapter-declared Rounds/Total columns
// rendered blindly.
test('leaderboard: club championship — rounds, totals ascending, public board; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const athleteA = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('competition_standings').select('id').limit(1);
  test.skip(!!probe.error, `standings missing — run migrations 151–154 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Golf Club ${stamp}`;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  // Roster rows are what make athletes enterable (§8 invariant 3): the
  // owner and athlete A both hold ACTIVE roster rows; a follow-only
  // member must never appear in the picker or pass the API.
  // ONE homogeneous key set across all rows (the PGRST102 rule).
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: clubId, profile_id: athleteA.id, role: 'member', kind: 'follow' },
    { club_id: clubId, profile_id: athleteA.id, role: 'member', kind: 'roster' },
  ]);
  const { data: season } = await admin
    .from('seasons')
    .insert({ club_id: clubId, label: '2026' })
    .select()
    .single();

  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${clubId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });

      // Create the leaderboard competition (golf → ascending default).
      await page.getByLabel('Competition name').fill('Club Championship');
      await page.getByLabel('Competition season').selectOption(season!.id);
      await page.getByLabel('Competition sport').selectOption('golf');
      await page.getByLabel('Competition format').selectOption('leaderboard');
      // G1: golf leaderboards pick a rule; this spec is the plain-total board.
      await page.getByLabel('Scoring rule').selectOption('stroke_total');
      await page.getByLabel('Public competition').check();
      await page.getByRole('button', { name: 'Add competition' }).click();
      await expect(page.getByText('Club Championship', { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Enter both rostered athletes (the expander stays open across the
      // refetch — the toggle reads "Close entries", so assert the CHIPS).
      await page.getByRole('button', { name: 'Entries (0)' }).click();
      await page
        .getByLabel('Enter an athlete in Club Championship')
        .selectOption({ label: 'Edge Alpha' });
      await expect(
        page.locator('span.rounded-full').filter({ hasText: 'Edge Alpha' })
      ).toBeVisible({ timeout: 15_000 });
      await page
        .getByLabel('Enter an athlete in Club Championship')
        .selectOption({ label: 'Edge Bravo' });
      await expect(
        page.locator('span.rounded-full').filter({ hasText: 'Edge Bravo' })
      ).toBeVisible({ timeout: 15_000 });

      // Activate — the public payload lists active|completed only.
      await page.getByRole('button', { name: 'Activate' }).click();
      await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }

    // DB truth so far: two athlete entries, roster-backed.
    const { data: comp } = await admin
      .from('competitions')
      .select('id, format, entrant_type')
      .eq('club_id', clubId)
      .single();
    expect(comp).toMatchObject({ format: 'leaderboard', entrant_type: 'athlete' });
    const competitionId = comp!.id as string;
    const { data: entries } = await admin
      .from('competition_entries')
      .select('id, profile_id, team_id, status')
      .eq('competition_id', competitionId);
    expect(entries).toHaveLength(2);
    for (const e of entries!) {
      expect(e.team_id).toBeNull();
      expect(e.status).toBe('approved');
    }
    const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));

    // Two rounds via the detail console + score entry.
    const ctx2 = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx2.newPage();
      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: 'Club Championship' })).toBeVisible({
        timeout: 20_000,
      });
      for (const label of ['Round 1', 'Round 2']) {
        await page.getByLabel('Round label').fill(label);
        await page.getByRole('button', { name: 'Add round' }).click();
        await expect(page.getByText(`${label} · 2 players`)).toBeVisible({ timeout: 15_000 });
      }

      // Scores round 1: the owner (Edge Bravo) 72, Edge Alpha 75 — BY
      // LABEL (participant DOM order is DB order, not seed order).
      await page.getByRole('button', { name: 'Enter score' }).first().click();
      await page.getByLabel('Score for Edge Bravo').fill('72');
      await page.getByLabel('Score for Edge Alpha').fill('75');
      await page.getByRole('button', { name: 'Save result' }).click();
      await expect(page.getByText('Result saved')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Standings', exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 375px: rounds + standings stay usable.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByRole('heading', { name: 'Standings', exact: true })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx2.close();
    }

    // Standings truth: ascending — the lower total leads after round 1;
    // Rounds/Total columns come from the adapter.
    const ownerEntry = entryOf.get(owner.id)!;
    const { data: standings } = await admin
      .from('competition_standings')
      .select('entry_id, rank, points, played')
      .eq('competition_id', competitionId)
      .order('rank');
    expect(standings).toHaveLength(2);
    expect(standings![0]).toMatchObject({ entry_id: ownerEntry, rank: 1, points: 72, played: 1 });
    expect(standings![1]).toMatchObject({ rank: 2, points: 75 });

    // The public board (anon) renders the ascending table with TOT/RDS.
    const ctxAnon = await browser.newContext();
    try {
      const pageAnon = await ctxAnon.newPage();
      const apiRes = await pageAnon.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
      const payload = await apiRes.json();
      const board = payload.competitions.find((c: { id: string }) => c.id === competitionId);
      expect(board.columns.map((c: { shortLabel: string }) => c.shortLabel)).toEqual(['RDS', 'TOT']);
      expect(board.rows[0].points).toBe(72);
    } finally {
      await ctxAnon.close();
    }
  } finally {
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
