import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// Program 11 L1 — the league membership settings (migration 177; the twin
// of club-membership-settings). A league is public + open by default; a
// manager flips visibility and join policy from the console's Membership
// section (the league PATCH, which now revalidates the org site); the
// league GET reflects them; a member cannot change them. 375px console.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('league membership settings: defaults public/open → PATCH flips → GET reflects → member 403 → console selects at 375px', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('leagues').select('visibility, join_policy').limit(1);
  test.skip(!!probe.error, `membership columns missing — run migration 177 (${probe.error?.message})`);

  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Membership League ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf' })
    .select('id, visibility, join_policy')
    .single();
  const leagueId = league!.id as string;
  expect(league).toMatchObject({ visibility: 'public', join_policy: 'open' });
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    // Defaults on the GET.
    let res = await ownerApi.get(`/api/leagues/${leagueId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()) as object).toMatchObject({ visibility: 'public', joinPolicy: 'open' });

    // A member cannot change them; the manager can.
    res = await alphaApi.patch(`/api/leagues/${leagueId}`, { data: { visibility: 'private' } });
    expect(res.status()).toBe(403);
    res = await ownerApi.patch(`/api/leagues/${leagueId}`, { data: { visibility: 'private', joinPolicy: 'approval' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.get(`/api/leagues/${leagueId}`);
    expect((await res.json()) as object).toMatchObject({ visibility: 'private', joinPolicy: 'approval' });
    const { data: row } = await admin.from('leagues').select('visibility, join_policy').eq('id', leagueId).single();
    expect(row).toEqual({ visibility: 'private', join_policy: 'approval' });
    // Bad values are refused.
    res = await ownerApi.patch(`/api/leagues/${leagueId}`, { data: { visibility: 'secret' } });
    expect(res.status()).toBe(400);

    // The console at 375px: the Membership section, its selects, a flip back.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name: 'Membership', level: 2 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Visibility')).toHaveValue('private');
      await expect(page.getByLabel('Joining')).toHaveValue('approval');
      await page.getByLabel('Visibility').selectOption('public');
      await expect(page.getByText('Your league is now public')).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      await expect
        .poll(async () => (await admin.from('leagues').select('visibility').eq('id', leagueId).single()).data?.visibility, { timeout: 10_000 })
        .toBe('public');
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
