import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The self-service "Start a league" flow (116): user A submits via the UI
// and sees the pending banner (server-truth refetch); the duplicate is
// asserted via the API — the partial unique index's 23505 → 409 is the
// authority, sturdier than a second UI pass. The ADMIN decision path is
// deliberately not e2e-driven (ADMIN_EMAILS is unmintable here) — Tom's
// first real approval from /dashboard/leagues is that probe.
test('league request: submit via UI, pending banner, duplicate 409', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('league_requests').select('id').limit(1);
  test.skip(!!probe.error, `league_requests missing — run migration 116 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA League Request ${stamp}`;

  try {
    await page.goto('/league/start');
    await expect(page.getByRole('heading', { name: 'Start a league' })).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('e2e request probe');
    await page.getByRole('button', { name: 'Submit request' }).click();

    // The pending banner comes from the refetch, never optimistically.
    await expect(page.getByText(`${name} is waiting for review`)).toBeVisible({ timeout: 15_000 });

    const { data: rows } = await admin
      .from('league_requests')
      .select('id, status')
      .eq('requester_profile_id', userA.id)
      .eq('name', name);
    expect(rows?.length).toBe(1);
    expect(rows?.[0].status).toBe('pending');

    // One pending per user: a second submit is refused by the index.
    const api = await apiAs('state.json');
    try {
      const res = await api.post('/api/leagues/requests', {
        data: { name: `${name} again`, sportKey: 'golf' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);
    } finally {
      await api.dispose();
    }
  } finally {
    await admin.from('league_requests').delete().eq('requester_profile_id', userA.id);
  }
});
