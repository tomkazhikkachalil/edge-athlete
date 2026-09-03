import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// Phase 9 V1 — the membership settings (migration 176). A club is public +
// open by default; a manager flips visibility and join policy from the
// console's Membership section (the club PATCH, which now revalidates the
// org site); the club GET reflects them; a member cannot change them.
// 375px console.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('membership settings: defaults public/open → PATCH flips → GET reflects → member 403 → console selects at 375px', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('clubs').select('visibility, join_policy').limit(1);
  test.skip(!!probe.error, `membership columns missing — run migration 176 (${probe.error?.message})`);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Membership Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id, visibility, join_policy')
    .single();
  const clubId = club!.id as string;
  expect(club).toMatchObject({ visibility: 'public', join_policy: 'open' });
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    // Defaults on the GET.
    let res = await ownerApi.get(`/api/clubs/${clubId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()) as object).toMatchObject({ visibility: 'public', joinPolicy: 'open' });

    // A member cannot change them; the manager can.
    res = await alphaApi.patch(`/api/clubs/${clubId}`, { data: { visibility: 'private' } });
    expect(res.status()).toBe(403);
    res = await ownerApi.patch(`/api/clubs/${clubId}`, { data: { visibility: 'private', joinPolicy: 'approval' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.get(`/api/clubs/${clubId}`);
    expect((await res.json()) as object).toMatchObject({ visibility: 'private', joinPolicy: 'approval' });
    const { data: row } = await admin.from('clubs').select('visibility, join_policy').eq('id', clubId).single();
    expect(row).toEqual({ visibility: 'private', join_policy: 'approval' });
    // Bad values are refused.
    res = await ownerApi.patch(`/api/clubs/${clubId}`, { data: { visibility: 'secret' } });
    expect(res.status()).toBe(400);

    // The console at 375px: the Membership section, its selects, a flip back.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${clubId}`);
      await expect(page.getByRole('heading', { name: 'Membership', level: 2 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Visibility')).toHaveValue('private');
      await expect(page.getByLabel('Joining')).toHaveValue('approval');
      await page.getByLabel('Visibility').selectOption('public');
      await expect(page.getByText('Your club is now public')).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      await expect
        .poll(async () => (await admin.from('clubs').select('visibility').eq('id', clubId).single()).data?.visibility, { timeout: 10_000 })
        .toBe('public');
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
