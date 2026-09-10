import { test, expect } from '@playwright/test';
import { adminClient, deleteQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Recruiting skeleton R2 — the scout account. POST /api/signup with
// actorRole 'scout' mints user_type 'scout' (server-decided, never the
// client's user_type), no handle, the affiliation on the row; the scout
// lands on /app/scout; an athlete account meets the not-for-you screen
// there; the header carries the Scouting door. Self-skips pre-182 (the
// user_type CHECK must admit 'scout'). @mobile: the shell at phone width.

test('scout signup: the actor branch mints a scout, lands on /app/scout; athletes are refused @mobile', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  // The door exists regardless of the database: Athlete sign-up → the role
  // chooser → "I'm a coach or scout" → the scout form (with the affiliation).
  const doorCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await doorCtx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Athlete' }).click();
    await expect(page.getByRole('heading', { name: "Who's setting this up?" })).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-scout-door]').click();
    await expect(page.locator('[data-scout-form]')).toBeVisible();
    await expect(page.locator('#sc-affiliation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your scout account' })).toBeVisible();
  } finally {
    await doorCtx.close();
  }

  const probe = await admin.from('profiles').select('scout_affiliation').limit(1);
  test.skip(!!probe.error, `profiles.scout_affiliation missing — run migration 182 (${probe.error?.message})`);

  const rand = Math.random().toString(36).slice(2, 10);
  const email = `edgeqa-scout-${rand}@example.com`;
  const password = `Qa!${Math.random().toString(36).slice(2, 12)}9`;
  let scoutId: string | null = null;
  try {
    // The signup bucket is per IP (5/h): three projects × three specs would trip it — reset first.
    await resetRateBucket(admin, 'signup', '');
    const res = await request.post('/api/signup', {
      data: {
        email,
        password,
        actorRole: 'scout',
        // The client's user_type is ignored — the actor decides.
        profileData: { first_name: 'Sam', last_name: 'Scout', user_type: 'league', scout_affiliation: 'QA Ravens' },
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const { data: row } = await admin.from('profiles').select('id, user_type, handle, scout_affiliation, display_name').eq('email', email).single();
    expect(row).toMatchObject({ user_type: 'scout', handle: null, scout_affiliation: 'QA Ravens' });
    scoutId = row!.id as string;

    // The scout's home; the athlete's not-for-you screen.
    const scoutCtx = await browser.newContext({ storageState: await mintStorageState({ id: scoutId, email, password }) });
    try {
      const page = await scoutCtx.newPage();
      await page.goto('/app/scout');
      await expect(page.locator('[data-scout-home]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 1 })).toContainText("Sam's scouting");
      await expect(page.getByText('QA Ravens')).toBeVisible();
      const width = page.viewportSize()?.width ?? 1280;
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(width);
      // `/` routes a scout to the scouting area, never the athlete wizard.
      await page.goto('/');
      await page.waitForURL(/\/app\/scout/, { timeout: 20_000 });
    } finally {
      await scoutCtx.close();
    }
    const athleteCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await athleteCtx.newPage();
      await page.goto('/app/scout');
      await expect(page.locator('[data-scout-gate="not-scout"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('link', { name: 'Back to feed' })).toBeVisible();
      expect(await page.locator('[data-scout-menu]').count()).toBe(0);
    } finally {
      await athleteCtx.close();
    }
  } finally {
    if (scoutId) await deleteQaUser(scoutId).catch(() => {});
  }
});
