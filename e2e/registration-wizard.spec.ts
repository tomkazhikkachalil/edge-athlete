import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaChild,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody,
  registrationFlagOnTarget,
} from './helpers/qa-user';

// The family wizard (phase 5 R3): a guardian registers a supervised child
// end-to-end through the UI — who → offering → details (medical notes) →
// photo consent → review → done. DB truth pins the 'registered' season
// row, the submission record, and the guardian-granted photo consent
// (the 159 contract riding the registration). The org-page banner shows
// the open-window CTA; 375px holds.
test('registration wizard: guardian registers a child; org-page CTA; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const guardian = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('registrations').select('id').limit(1);
  test.skip(!!probe.error, `registrations missing — run migration 162 (${probe.error?.message})`);
  const flagProbeApi = await apiAs('state.json');
  const flagOn = await registrationFlagOnTarget(flagProbeApi);
  await flagProbeApi.dispose();
  test.skip(!flagOn, 'FEATURE_ORG_REGISTRATION off on this target');
  test.skip(!guardianFlagOn(), 'FEATURE_GUARDIAN_PROFILES off on this target');

  const stamp = Date.now();
  const name = `QA Wizard League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  let childId: string | null = null;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27', starts_on: '2026-09-01' })
      .select()
      .single();
    const { data: division } = await admin
      .from('divisions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `U13 A ${stamp}`,
        age_band: 'U13',
        gender_stream: 'Mixed',
      })
      .select()
      .single();

    const ownerApi = await apiAs('state-b.json');
    try {
      const res = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
        data: { seasonId: season!.id, opensAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }

    childId = await createQaChild(guardian.id, {
      firstName: `Wiz${stamp}`,
      lastName: 'Kid',
      handle: `wizkid${stamp}`,
    });

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctx.newPage();

      // The org page shows the open-window CTA.
      await page.goto(`/league/${leagueId}`);
      await expect(page.getByText('Registration is open')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('link', { name: 'Register', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: `Register with ${name}` })
      ).toBeVisible({ timeout: 20_000 });

      // who → the child.
      await page.getByRole('radio', { name: `Wiz${stamp} Kid` }).check();
      await page.getByRole('button', { name: 'Next' }).click();

      // offering → the open division.
      await page.getByRole('radio', { name: new RegExp(`U13 A ${stamp}`) }).check();
      await page.getByRole('button', { name: 'Next' }).click();

      // details.
      await page.getByLabel('Emergency contact name').fill('Pat Contact');
      await page.getByLabel('Emergency contact phone').fill('555-0100');
      await page.getByLabel(/Medical notes/).fill(`bee sting allergy ${stamp}`);
      await page.getByRole('button', { name: 'Next' }).click();

      // consents.
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Next' }).click();

      // review → submit.
      await expect(page.getByText(`U13 A ${stamp}`)).toBeVisible();
      await page.getByRole('button', { name: 'Register', exact: true }).click();
      await expect(page.getByText(`Wiz${stamp} Kid is registered`)).toBeVisible({
        timeout: 20_000,
      });

      // 375px: the done state (and the wizard shell) hold.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText(`Wiz${stamp} Kid is registered`)).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }

    // DB truth: the season row, the submission record, guardian consent.
    const { data: rosterRow } = await admin
      .from('memberships')
      .select('status, season_id, photo_consent, photo_consent_by')
      .eq('league_id', leagueId)
      .eq('profile_id', childId)
      .eq('kind', 'roster')
      .eq('scope_type', 'org')
      .single();
    expect(rosterRow).toMatchObject({
      status: 'registered',
      season_id: season!.id,
      photo_consent: true,
      photo_consent_by: guardian.id,
    });
    const { data: regRow } = await admin
      .from('registrations')
      .select('division_id, submitted_by, answers')
      .eq('league_id', leagueId)
      .eq('profile_id', childId)
      .single();
    expect(regRow).toMatchObject({ division_id: division!.id, submitted_by: guardian.id });
    expect(JSON.stringify(regRow!.answers)).toContain(`bee sting allergy ${stamp}`);
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    if (childId) await deleteQaUser(childId);
  }
});
