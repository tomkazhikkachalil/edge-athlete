import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The league onboarding WIZARD (phase 1 round 2): identity + capabilities →
// sport → structure (template grid, prune a row, add a team) → connections
// (a stub) → review → submit. The pending banner stays the server-truth
// refetch (the pinned "is waiting for review" string) and one-pending is
// still the 23505's job. The admin decision path stays a prod probe
// (ADMIN_EMAILS is unmintable here).
test('league wizard: full drive → pending banner + draft columns; duplicate 409', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('league_requests').select('structure_draft').limit(1);
  test.skip(!!probe.error, `wizard columns missing — run migration 149 (${probe.error?.message})`);

  const name = 'QA Wizard League ' + Date.now();
  try {
    await page.goto('/league/start');
    await expect(page.getByRole('heading', { name: 'Start a league' })).toBeVisible({
      timeout: 15_000,
    });

    // Identity + capabilities (competitions pre-checked on the league side).
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('e2e wizard probe');
    await page.getByText('We run teams', { exact: false }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Sport → ice hockey (unlocks the template).
    await page.getByLabel('Sport').selectOption('ice_hockey');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Structure: template grid → prune one row → add a team.
    await page.getByRole('button', { name: /Start from the Ice Hockey template/i }).click();
    const beforeText = await page.getByText(/\d+ divisions?/).first().textContent();
    const before = parseInt(beforeText ?? '0', 10);
    expect(before).toBeGreaterThan(2);
    await page.getByRole('button', { name: /^Remove U9/ }).first().click();
    await expect(page.getByText(`${before - 1} divisions`)).toBeVisible();
    await page.getByLabel('Team name').fill('Blazers U13 A');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Connections: one stub (league side needs no sport on stubs).
    await page.getByLabel('New club name').fill('QA Stub Club');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('QA Stub Club')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Review → submit → the pinned server-truth banner.
    await expect(page.getByText(`${before - 1} divisions · 1 team`)).toBeVisible();
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText(`${name} is waiting for review`)).toBeVisible({ timeout: 15_000 });

    // DB truth: all four wizard columns landed.
    const { data: rows } = await admin
      .from('league_requests')
      .select('status, operates_competitions, operates_teams, structure_draft, connections_draft, sport_key')
      .eq('requester_profile_id', userA.id)
      .eq('name', name);
    expect(rows).toHaveLength(1);
    const row = rows![0];
    expect(row.status).toBe('pending');
    expect(row.operates_competitions).toBe(true);
    expect(row.operates_teams).toBe(true);
    const draft = row.structure_draft as { divisions: { sportKey: string }[]; teams: string[] };
    expect(draft.divisions).toHaveLength(before - 1);
    // The server re-stamps every division sport with the request sport.
    expect(draft.divisions.every(d => d.sportKey === 'ice_hockey')).toBe(true);
    expect(draft.teams).toEqual(['Blazers U13 A']);
    const conns = row.connections_draft as { stubs: { name: string }[] };
    expect(conns.stubs).toEqual([{ name: 'QA Stub Club' }]);

    // One-pending: a second submit (old minimal payload — back-compat) → 409.
    const api = await apiAs('state.json');
    try {
      const res = await api.post('/api/leagues/requests', {
        data: { name: name + ' again', sportKey: 'golf' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);
    } finally {
      await api.dispose();
    }
  } finally {
    await admin.from('league_requests').delete().eq('requester_profile_id', userA.id);
  }
});
