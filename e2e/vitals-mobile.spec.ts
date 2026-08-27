import { test, expect } from '@playwright/test';
import { loadQaUser, adminClient } from './helpers/qa-user';

// The first phone-width spec (390×844 via the `mobile` project — see
// playwright.config.ts). Web & Mobile Ship Together rule: the redesigned
// Vitals must be REACHABLE at phone width, where the tab strip overflows and
// hid it entirely before the ?tab= deep link + scroll-into-view landed.
// Assertions use the hero's always-rendered tile, so this spec needs no
// seeded vitals data and can run before vitals.spec.ts (alphabetical order).
test('vitals @mobile: deep links reach the dashboard at phone width', async ({ page, browser }) => {
  test.setTimeout(120_000);

  // Pin preconditions instead of assuming them: a leaked
  // vitals_privacy.hidden=true from an earlier spec turned the visitor half
  // into a lock card (the Aug 2026 order flake). Clear it up front.
  const userA0 = loadQaUser('user.json');
  await adminClient().from('profiles').update({ vitals_privacy: null }).eq('id', userA0.id);

  // /athlete?tab=vitals — the URL alone must land on Vitals, no taps: the
  // tab button is scrolled into the strip's view and the dashboard renders.
  await page.goto('/athlete?tab=vitals');
  const vitalsTab = page.getByRole('button', { name: /vitals/i }).first();
  await expect(vitalsTab).toBeInViewport({ timeout: 15_000 });
  await expect(page.getByText('Workouts this week')).toBeVisible({ timeout: 15_000 });

  // /u/<handle>?tab=vitals — the public-profile route (where most in-app
  // profile links land) must carry the same design. User B views user A's
  // temporarily-public profile; visibility is restored afterwards because
  // later specs in the shared-QA-user suite rely on A being private.
  const userA = loadQaUser('user.json');
  const admin = adminClient();
  const { data: prof } = await admin
    .from('profiles')
    .select('handle, visibility')
    .eq('id', userA.id)
    .single();
  // QA users are created handle-less; /u/ needs one. Unique per run (user id
  // prefix), removed with the user at teardown.
  let handle = prof?.handle as string | null;
  if (!handle) {
    handle = `edgeqa-${userA.id.slice(0, 8)}`;
    const { error: handleError } = await admin
      .from('profiles')
      .update({ handle })
      .eq('id', userA.id);
    expect(handleError, 'failed to assign QA handle').toBeNull();
  }
  const priorVisibility = prof!.visibility;
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  const ctxB = await browser.newContext({
    storageState: 'e2e/.auth/state-b.json',
    viewport: { width: 390, height: 844 },
  });
  try {
    const pageB = await ctxB.newPage();
    // The @-prefixed display form — the exact shape getProfileUrl emits
    // (regression: this used to double-encode into "Profile Not Found").
    await pageB.goto(`/u/@${handle}?tab=vitals`);
    await expect(pageB.getByText('Workouts this week')).toBeVisible({ timeout: 15_000 });
    // Read-only for a visitor: no owner actions at phone width either.
    await expect(pageB.getByRole('button', { name: 'Start Workout' })).toHaveCount(0);
  } finally {
    await ctxB.close();
    await admin.from('profiles').update({ visibility: priorVisibility }).eq('id', userA.id);
  }
});
