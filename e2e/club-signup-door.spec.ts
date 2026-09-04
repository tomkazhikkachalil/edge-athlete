import { test, expect } from '@playwright/test';
import { adminClient, deleteQaUser, guardianFlagOn, loadQaUser } from './helpers/qa-user';

// Club sign-up, part 1 (phase 7 C1): the door. The login page's Club and
// League buttons no longer end in a waitlist popup: the account comes
// first, then the wizard. The intent rides sessionStorage through the
// registration hard-reload; `/` honours it after sign-in; the signed-out
// /club/start card parks it too; "Explore as Guest" is a real anonymous door.
//
// Org staff program (Sep 4 2026, mig 178): the door now opens on "Do you
// already have an account?" and the create path is the ORGANIZER account —
// name, email, password, NO date of birth, no handle — landing as
// user_type 'organizer'. Self-skips (the organizer assertion only) on a
// pre-178 database, where the signup answers 503 "not available yet".

const rand = () => Math.random().toString(36).slice(2, 8);

test('the Club door: existing-account question → organizer account (no DOB) → /club/start?sport=golf; signed-out /club/start parks the intent; ?next= honoured; Explore as Guest; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  // The default storageState is SIGNED IN (the fake-anonymity trap) — the
  // door is a signed-out flow, so it runs in its own anonymous context.
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anon.newPage();
  const email = `edgeqa-door-${rand()}@example.com`;
  const password = `Qa!${rand()}${rand()}9`;
  let createdId: string | null = null;

  try {
    // Signed-out /club/start: the CTA parks the intent both ways.
    await page.goto('/club/start');
    const cta = page.getByRole('link', { name: 'Create an account or sign in' });
    await expect(cta).toBeVisible({ timeout: 20_000 });
    expect(await cta.getAttribute('href')).toContain('next=%2Fclub%2Fstart');

    // The login page at phone width: the four role doors + the guest door.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Club/ })).toBeVisible({ timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

    // Explore as Guest is a real door, not a waitlist.
    await page.getByRole('button', { name: /Explore as Guest/ }).click();
    await page.waitForURL(/\/explore/, { timeout: 20_000 });
    expect(await page.evaluate(() => document.body.innerText)).not.toContain("We're not quite ready");

    // The Club door → the account → the wizard.
    await page.goto('/');
    await page.getByRole('button', { name: /Club/ }).click();
    if (guardianFlagOn()) {
      // "Do you already have an account?" comes FIRST — never "athlete or
      // parent". "No, create one" → the organizer form: no DOB step, no
      // handle, no athlete fields (still no horizontal overflow at 375px).
      await expect(page.getByRole('heading', { name: 'Set up your club' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: /Yes, sign me in/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /I'm the athlete/ })).toHaveCount(0);
      await page.getByRole('button', { name: /No, create one/ }).click();
      await expect(page.getByRole('heading', { name: 'Create your organizer account' })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('input[type="date"]')).toHaveCount(0);
      await expect(page.locator('#handle')).toHaveCount(0);
      await expect(page.getByRole('radio', { name: 'Club' })).toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await page.getByLabel('First Name').fill('Door');
      await page.getByLabel('Last Name').fill('Tester');
      await page.getByLabel('Email').fill(email);
      const pw = page.locator('input[type="password"]');
      await pw.nth(0).fill(password);
      await pw.nth(1).fill(password);
      await page.getByRole('button', { name: /Create Account/i }).click();
      // Pre-178 database: the branch answers 503 "not available yet" and the
      // auth user is rolled back — nothing else in this spec depends on it.
      const notYet = page.getByText(/not available yet/);
      const wizard = page.waitForURL(/\/club\/start\?sport=golf/, { timeout: 30_000 }).then(() => 'wizard' as const);
      const outcome = await Promise.race([
        wizard,
        notYet.waitFor({ timeout: 30_000 }).then(() => 'pre-178' as const),
      ]).catch(() => 'timeout' as const);
      if (outcome === 'pre-178') {
        test.skip(true, 'migration 178 not applied: organizer accounts answer 503 here');
        return;
      }
      expect(outcome).toBe('wizard');
    } else {
      // The legacy single form, then a manual sign-in — `/` still honours the parked intent.
      await page.getByLabel('First Name').fill('Door');
      await page.getByLabel('Last Name').fill('Tester');
      await page.locator('#handle').fill(`door${rand()}`);
      await expect(page.getByText('✓ Handle is available!')).toBeVisible({ timeout: 20_000 });
      await page.getByLabel('Email').fill(email);
      const pw = page.locator('input[type="password"]');
      await pw.nth(0).fill(password);
      await pw.nth(1).fill(password);
      await page.getByRole('button', { name: /Create Account/i }).click();
      await expect(page.getByText(/Account created successfully/)).toBeVisible({ timeout: 20_000 });
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await page.waitForURL(/\/club\/start\?sport=golf/, { timeout: 30_000 });
    }
    await expect(page.getByRole('heading', { name: 'Start a club' })).toBeVisible({ timeout: 20_000 });
    // By profile email — auth.admin.listUsers pages in creation order and
    // missed a brand-new account on the first production run.
    const { data: prof } = await admin
      .from('profiles')
      .select('id, user_type, onboarded_at, handle, dob')
      .eq('email', email)
      .maybeSingle();
    createdId = prof?.id ?? null;
    expect(createdId, 'the account exists').toBeTruthy();
    if (guardianFlagOn()) {
      // The organizer account: its own kind, no handle, no date of birth.
      expect(prof!.user_type).toBe('organizer');
      expect(prof!.handle).toBeNull();
      expect(prof!.dob).toBeNull();
      // The onboarding stamp is a best-effort PUT fired right before the hard
      // navigation — poll for it instead of racing it (the flaky first attempt).
      await expect
        .poll(async () => (await admin.from('profiles').select('onboarded_at').eq('id', createdId!).single()).data?.onboarded_at ?? null, { timeout: 15_000 })
        .toBeTruthy();
      // `/` routes an onboarded organizer to the feed, never the athlete wizard;
      // the feed carries the header door to their orgs card.
      await page.goto('/');
      await page.waitForURL(/\/feed/, { timeout: 30_000 });
    } else {
      expect(prof!.user_type).toBe('athlete');
    }

    // A plain sign-in with ?next= (an existing user) lands in the wizard too.
    const userB = loadQaUser('user-b.json');
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const p2 = await ctx.newPage();
      await p2.goto('/?next=%2Fleague%2Fstart%3Fsport%3Dgolf');
      await p2.locator('input[name="email"]').fill(userB.email);
      await p2.locator('input[name="password"]').fill(userB.password);
      await p2.getByRole('button', { name: 'Login', exact: true }).click();
      await p2.waitForURL(/\/league\/start\?sport=golf/, { timeout: 30_000 });
      await expect(p2.getByRole('heading', { name: 'Start a league' })).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  } finally {
    await anon.close();
    if (createdId) await deleteQaUser(createdId);
  }
});
