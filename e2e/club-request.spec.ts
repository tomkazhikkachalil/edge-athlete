import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The "Start a club" flow (117) — mirror of league-request.spec.ts. The
// admin decision path is probed via the local-ADMIN_EMAILS recipe, not e2e.
test('club request: submit via UI, pending banner, duplicate 409', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('club_requests').select('id').limit(1);
  test.skip(!!probe.error, `club_requests missing — run migration 117 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Club Request ${stamp}`;

  try {
    await page.goto('/club/start');
    await expect(page.getByRole('heading', { name: 'Start a club' })).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('e2e club request probe');
    await page.getByRole('button', { name: 'Submit request' }).click();

    await expect(page.getByText(`${name} is waiting for review`)).toBeVisible({ timeout: 15_000 });

    const { data: rows } = await admin
      .from('club_requests')
      .select('id, status')
      .eq('requester_profile_id', userA.id)
      .eq('name', name);
    expect(rows?.length).toBe(1);
    expect(rows?.[0].status).toBe('pending');

    const api = await apiAs('state.json');
    try {
      const res = await api.post('/api/clubs/requests', {
        data: { name: `${name} again` },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);
    } finally {
      await api.dispose();
    }
  } finally {
    await admin.from('club_requests').delete().eq('requester_profile_id', userA.id);
  }
});
