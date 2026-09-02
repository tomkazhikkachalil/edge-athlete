import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The club onboarding WIZARD — the multi-sport path: no sport step, the
// template buttons ARE the sport pickers (each adds a per-sport grid
// section), and a stub-LEAGUE row carries an explicit sport (leagues'
// sport_key is NOT NULL).
test('club wizard: two sport sections + sported stub league → pending + draft truth', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('club_requests').select('structure_draft').limit(1);
  test.skip(!!probe.error, `wizard columns missing — run migration 149 (${probe.error?.message})`);

  const name = 'QA Wizard Club ' + Date.now();
  const ctx = await page.context().browser()!.newContext({ storageState: 'e2e/.auth/state-b.json' });
  const pageB = await ctx.newPage();
  try {
    await pageB.goto('/club/start');
    await expect(pageB.getByRole('heading', { name: 'Start a club' })).toBeVisible({
      timeout: 15_000,
    });

    // Identity (teams pre-checked on the club side).
    await pageB.getByLabel('Name').fill(name);
    await pageB.getByRole('button', { name: 'Continue' }).click();

    // Structure: two sport sections via the template buttons.
    await pageB.getByRole('button', { name: '+ Ice hockey' }).click();
    await pageB.getByRole('button', { name: '+ Soccer' }).click();
    await expect(pageB.getByText('Ice Hockey', { exact: true })).toBeVisible();
    await expect(pageB.getByText('Soccer', { exact: true })).toBeVisible();
    await pageB.getByRole('button', { name: 'Continue' }).click();

    // Connections: a stub LEAGUE with its required sport.
    await pageB.getByLabel('New league name').fill('QA Stub League');
    await pageB.getByLabel('New league sport').selectOption('ice_hockey');
    await pageB.getByRole('button', { name: 'Add', exact: true }).click();
    await pageB.getByRole('button', { name: 'Continue' }).click();

    // Review → submit → pinned banner.
    await pageB.getByRole('button', { name: 'Submit request' }).click();
    await expect(pageB.getByText(`${name} is waiting for review`)).toBeVisible({ timeout: 15_000 });

    // DB truth: two sports among divisions; the stub carries its sport.
    const { data: rows } = await admin
      .from('club_requests')
      .select('status, operates_teams, structure_draft, connections_draft')
      .eq('requester_profile_id', userB.id)
      .eq('name', name);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe('pending');
    expect(rows![0].operates_teams).toBe(true);
    const draft = rows![0].structure_draft as { divisions: { sportKey: string }[] };
    const sports = new Set(draft.divisions.map(d => d.sportKey));
    expect(sports).toEqual(new Set(['ice_hockey', 'soccer']));
    const conns = rows![0].connections_draft as { stubs: { name: string; sportKey?: string }[] };
    expect(conns.stubs).toEqual([{ name: 'QA Stub League', sportKey: 'ice_hockey' }]);
  } finally {
    // C4: the request provisioned a pending club — delete it too (FK SET NULL would leak it).
    const { data: provisioned } = await admin.from('club_requests').select('created_club_id').eq('requester_profile_id', userB.id);
    const provisionedIds = (provisioned ?? []).map(r => r.created_club_id as string | null).filter((id): id is string => !!id);
    if (provisionedIds.length) await admin.from('clubs').delete().in('id', provisionedIds);
    await admin.from('club_requests').delete().eq('requester_profile_id', userB.id);
    await ctx.close();
  }
});
