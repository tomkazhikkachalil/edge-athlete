import { test, expect, request } from '@playwright/test';
import { apiAs, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

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

test('athlete side: child login sees their guardian', async () => {
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
  } finally {
    await child.dispose();
    await api.dispose();
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
