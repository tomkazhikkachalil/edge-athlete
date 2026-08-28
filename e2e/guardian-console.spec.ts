import { test, expect, request } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// Family console (Aug 19) — the first guardian e2e coverage. The guardian
// feature is behind the build-time flag FEATURE_GUARDIAN_PROFILES: ON in
// .env.local (which the local webServer build reads), NOT set in CI — so the
// suite probes the flag and green-skips when the feature is dark.
//
// Serial: one child profile threads through every test, deleted in the
// cleanup test even when earlier steps fail. NOTE the QA sweep only matches
// edgeqa-* emails; a killed run can orphan the child's @minors.invalid
// shadow user — the always-run cleanup here is the mitigation.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const HANDLE = `eaqa_rider_${stamp}`;
const PIN = '4321';
let flagOn = true;
let childId = '';

test('setup: probe the flag and create a managed athlete', async () => {
  const api = await apiAs('state.json');
  try {
    // Flag probe: with the feature dark the route 404s before validation;
    // with it on, an empty body is a 400.
    const probe = await api.post('/api/guardian/athletes', { data: {} });
    if (probe.status() === 404) {
      flagOn = false;
      test.skip(true, 'guardian flag off in this environment');
      return;
    }
    expect(probe.status()).toBe(400);

    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15))
      .toISOString().split('T')[0];
    const res = await api.post('/api/guardian/athletes', {
      data: { first_name: 'Junior', last_name: 'Console', dob, handle: HANDLE },
    });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    childId = (await res.json()).profileId;
    expect(childId).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('console: roster card, chips, and the attention strip', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  await page.goto('/app/guardian');
  const main = page.locator('main');
  // Scope to main — the always-mounted off-canvas drawer also carries text.
  await expect(main.getByText('Junior Console').first()).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText('Consent needed')).toBeVisible();
  await expect(main.getByText('No login yet', { exact: true }).first()).toBeVisible();
  await expect(main.getByText(`Finish consent for Junior Console`)).toBeVisible();
});

test('per-athlete: safety change persists; going public is consent-gated', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  await page.goto(`/app/guardian/athlete/${childId}`);
  await expect(page.getByRole('heading', { name: 'Safety' })).toBeVisible({ timeout: 15_000 });

  // Messaging: nobody → fans_only, saved via the PATCH, survives a reload.
  await page.getByRole('button', { name: /Fans only/ }).click();
  await expect(page.getByText('Safety settings updated.')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Safety' })).toBeVisible();
  await expect
    .poll(async () =>
      page.getByRole('button', { name: /Fans only/ }).evaluate(el => el.className.includes('border-brand'))
    )
    .toBe(true);

  // Visibility: public must be refused until consent approves, verbatim copy,
  // and the optimistic selection must revert.
  await page.getByRole('button', { name: /^Public/ }).click();
  await expect(
    page.getByText('Complete the consent review before making this profile public.')
  ).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () =>
      page.getByRole('button', { name: /^Private/ }).evaluate(el => el.className.includes('border-brand'))
    )
    .toBe(true);
});

test('athlete side: child login sees their guardian; a pending post rings the guardian bell', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  const child = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const cred = await api.post(`/api/guardian/athletes/${childId}/credentials`, {
      data: { mode: 'pin', secret: PIN },
    });
    expect(cred.ok(), await readErrorBody(cred)).toBe(true);

    const login = await child.post('/api/auth/username-login', {
      data: { username: HANDLE, secret: PIN },
    });
    expect(login.ok(), await readErrorBody(login)).toBe(true);

    // The request context carries the session cookies the login set.
    const guardians = await child.get('/api/profile/guardians');
    expect(guardians.ok(), await readErrorBody(guardians)).toBe(true);
    const body = await guardians.json();
    // The QA user's display name comes from global-setup; assert the LINK
    // exists rather than a specific name (one guardian row, role guardian).
    expect(body.guardians?.length).toBe(1);
    expect(body.guardians[0].role).toBe('guardian');

    // Round 1 (guardian notifications): a supervised author's post is forced
    // to pending_approval AND pushes a notification to the guardian's bell.
    const post = await child.post('/api/posts', {
      data: { caption: `qa pending ${stamp}`, visibility: 'private' },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);

    await page.goto('/app/notifications');
    await expect(
      page.getByText('Junior shared a post that needs your review').first()
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await child.dispose();
    await api.dispose();
  }
});

test('queue + richer cards: hub action row with consent hint; approvals audience chip and athlete filter', async ({ page }) => {
  test.skip(!flagOn, 'guardian flag off');

  // Wave 2 queue: the pending post from the previous test surfaces as a
  // typed hub row, with the consent coupling made visible (approve will 403
  // until the consent review completes).
  await page.goto('/app/guardian');
  const main = page.locator('main');
  await expect(
    main.getByText('Junior Console shared a post for your review')
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    main.getByText('Consent needed before you can approve').first()
  ).toBeVisible();

  // Richer approval card: audience chip (the post was created private) and
  // the ?athlete= deep-link filter the hub rows and roster badges use.
  await page.goto(`/app/guardian/approvals?athlete=${childId}`);
  await expect(page.getByText('Showing only Junior Console')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Private — fans only').first()).toBeVisible();
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.getByText('Showing only Junior Console')).toHaveCount(0);
});

test('co-guardian lifecycle: invite → claim → roster of two → revoke → last-guardian block', async () => {
  test.skip(!flagOn, 'guardian flag off');
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    // A invites B by email; the URL is returned regardless of SMTP.
    const invite = await apiA.post(`/api/guardian/athletes/${childId}/guardians`, {
      data: { email: userB.email },
    });
    expect(invite.ok(), await readErrorBody(invite)).toBe(true);
    const { inviteUrl } = await invite.json();
    const token = String(inviteUrl).split('/invite/')[1];
    expect(token?.length).toBeGreaterThan(20);

    // B claims — the existing claim route validates and grants.
    const claim = await apiB.post(`/api/invites/${token}/claim`);
    expect(claim.ok(), await readErrorBody(claim)).toBe(true);

    // Roster of two, and the second-invite gate closes.
    const list = await apiA.get(`/api/guardian/athletes/${childId}/guardians`);
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    expect((await list.json()).guardians.length).toBe(2);
    const third = await apiA.post(`/api/guardian/athletes/${childId}/guardians`, {
      data: { email: 'edgeqa-third@example.com' },
    });
    expect(third.status()).toBe(409);

    // A revokes B; roster back to one.
    const revoke = await apiA.delete(`/api/guardian/athletes/${childId}/guardians`, {
      data: { guardianUserId: userB.id },
    });
    expect(revoke.ok(), await readErrorBody(revoke)).toBe(true);
    const after = await apiA.get(`/api/guardian/athletes/${childId}/guardians`);
    expect((await after.json()).guardians.length).toBe(1);

    // The invariant: the last guardian cannot remove themselves.
    const me = loadQaUser('user.json');
    const selfRemove = await apiA.delete(`/api/guardian/athletes/${childId}/guardians`, {
      data: { guardianUserId: me.id },
    });
    expect(selfRemove.status()).toBe(409);
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

// afterAll, not a test: serial mode skips remaining TESTS after a failure,
// which would orphan the child's @minors.invalid shadow user. Hooks run
// regardless.
test.afterAll(async () => {
  if (!flagOn || !childId) return;
  const api = await apiAs('state.json');
  try {
    const res = await api.delete(`/api/guardian/athletes/${childId}`, {
      data: { confirmHandle: HANDLE },
    });
    if (!res.ok()) {
      console.error('[e2e] guardian-console cleanup failed:', await readErrorBody(res));
    }
  } finally {
    await api.dispose();
  }
});
