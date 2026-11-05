import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, deleteQaUser, guardianFlagOn, qaEmail } from './helpers/qa-user';

// ── Sign-up with e-mail confirmations ON (Convention 56, Nov 2 2026) ────────
// Production confirms by e-mail; the "Confirm signup" template points at
// /auth/confirm by token hash. The mail's link is exactly what the admin
// API's generateLink mints, so the round-trip is probed here without a
// mailbox: the hash → a session → the account's door (onboarding for an
// athlete, the scouting area — stamped onboarded — for a scout); a used or
// garbage link → the sign-in page's sentence and its Resend door; and the
// sign-up form's own "Check your email" screen when the API says the
// account must confirm first.

const admin = adminClient();

async function mintConfirmLink(email: string, password: string): Promise<{ id: string; tokenHash: string }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'signup', email, password });
  if (error || !data?.user || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
  return { id: data.user.id, tokenHash: data.properties.hashed_token };
}

async function profileRow(id: string, email: string, userType: 'athlete' | 'scout') {
  const { error } = await admin.from('profiles').insert({
    id, email, display_name: 'Confirm Cam', full_name: 'Confirm Cam', first_name: 'Confirm', last_name: 'Cam',
    visibility: 'private', user_type: userType, onboarded_at: null,
  });
  if (error) throw new Error(`profile insert failed: ${error.message}`);
}

test('the link in the mail signs the account in and sends it to its door; a used link says so @mobile', async ({ browser }) => {
  const rand = Math.random().toString(36).slice(2, 10);
  const password = `Qa!${rand}9x`;
  const athlete = await mintConfirmLink(qaEmail(`confirm-a-${rand}`), password);
  const scout = await mintConfirmLink(qaEmail(`confirm-s-${rand}`), password);
  try {
    await profileRow(athlete.id, qaEmail(`confirm-a-${rand}`), 'athlete');
    await profileRow(scout.id, qaEmail(`confirm-s-${rand}`), 'scout');

    // The athlete: the link → a session → onboarding.
    const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
    const pageA = await ctxA.newPage();
    try {
      await pageA.goto(`/auth/confirm?token_hash=${athlete.tokenHash}&type=signup`);
      await expect(pageA).toHaveURL(/\/onboarding/, { timeout: 20_000 });
      const cookies = await ctxA.cookies();
      expect(cookies.some(c => /^sb-.*-auth-token/.test(c.name)), 'a session cookie').toBe(true);
    } finally {
      await ctxA.close();
    }
    // The same link again, on another device: used → the sign-in page with the sentence.
    const again = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders(), maxRedirects: 0 });
    try {
      const r = await again.get(`/auth/confirm?token_hash=${athlete.tokenHash}&type=signup`);
      expect(r.status()).toBe(307);
      const where = new URL(r.headers()['location'] ?? '', E2E_BASE_URL);
      expect(where.pathname + decodeURIComponent(where.search), 'a used link').toMatch(/^\/\?error=.*confirmation link/);
    } finally {
      await again.dispose();
    }

    // The scout: the link → stamped onboarded → the scouting area, never the athlete wizard.
    const ctxS = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
    const pageS = await ctxS.newPage();
    try {
      await pageS.goto(`/auth/confirm?token_hash=${scout.tokenHash}&type=signup`);
      await expect(pageS).toHaveURL(/\/app\/scout/, { timeout: 20_000 });
      const { data: row } = await admin.from('profiles').select('onboarded_at').eq('id', scout.id).single();
      expect(row?.onboarded_at, 'onboarded_at stamped on confirm').toBeTruthy();
    } finally {
      await ctxS.close();
    }

    // A garbage link, signed out: the sentence and the sign-in form.
    const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders(), maxRedirects: 0 });
    try {
      const r = await anon.get('/auth/confirm?token_hash=not-a-token&type=signup');
      expect(r.status()).toBe(307);
      const garbage = new URL(r.headers()['location'] ?? '', E2E_BASE_URL);
      expect(garbage.pathname + decodeURIComponent(garbage.search)).toMatch(/^\/\?error=.*confirmation link/);
      const bare = await anon.get('/auth/confirm');
      expect(bare.status()).toBe(307);
      const bareTo = new URL(bare.headers()['location'] ?? '', E2E_BASE_URL);
      expect(bareTo.pathname + bareTo.search).toBe('/?signin=1');
    } finally {
      await anon.dispose();
    }
  } finally {
    await deleteQaUser(athlete.id).catch(() => {});
    await deleteQaUser(scout.id).catch(() => {});
  }
});

test('the sign-up form says "Check your email" when the API answers confirmationRequired, with a Resend door @mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  try {
    // The API's answer with confirmations ON, without creating anything.
    await page.route('**/api/signup', route => route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ message: 'Account created successfully', user: { id: '00000000-0000-4000-8000-000000000001' }, confirmationRequired: true }),
    }));
    await page.route('**/auth/v1/resend**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    test.skip(!guardianFlagOn(), 'the step machine (RegistrationSteps) needs NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES=1');
    // The club door's path to the organizer form: the fewest fields.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.getByRole('button', { name: /Club/ }).click();
    await expect(page.getByRole('heading', { name: 'Set up your club' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /No, create one/ }).click();
    await expect(page.getByRole('heading', { name: 'Create your organizer account' })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('First Name').fill('Check');
    await page.getByLabel('Last Name').fill('Mail');
    await page.getByLabel('Email').fill('check-email@example.com');
    const passwords = page.locator('input[type="password"]');
    await passwords.nth(0).fill('Qa!checkmail9');
    await passwords.nth(1).fill('Qa!checkmail9');
    await page.getByRole('button', { name: /Create Account/i }).click();
    await expect(page.locator('[data-check-email]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-check-email]')).toContainText('check-email@example.com');
    await page.locator('[data-check-email-resend]').click();
    await expect(page.locator('[data-check-email] [role="status"]')).toContainText(/sent again/i);
  } finally {
    await ctx.close();
  }
});
