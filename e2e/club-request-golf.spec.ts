import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Club sign-up, part 2 (phase 7 C2): the golf fast path. `/club/start?sport=golf`
// (where the login-page door lands) pre-checks Golf, flips the capability
// defaults to competitions-only, offers an OPTIONAL home course whose pick
// prefills the name, website, phone and home town, and collapses the wizard
// to two steps. The request carries the site draft (migration 174) — and on
// a pre-174 database the request still lands without it (the PGRST204
// fallback), which is what this spec verifies until 174 runs.
//
// Runs at phone width end to end (the 375px pass).

const stamp = Math.random().toString(36).slice(2, 8);

test('golf fast path: Golf pre-checked → home course prefills → two steps → site_draft truth; 375px', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const draftProbe = await admin.from('club_requests').select('site_draft').limit(1);
  const hasSiteDraft = !draftProbe.error;

  // A catalog row with contact details but NO place row (the hint branch).
  const token = `qafp${stamp}`;
  const clubName = `QA Fast Path Golf Club ${stamp}`;
  const { data: course, error: seedError } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-fastpath-${stamp}`,
      name: `${token} Course`,
      club_name: clubName,
      city: 'Kanata',
      region: 'Ontario',
      country: 'Canada',
      country_code: 'CA',
      region_code: 'ON',
      website: `https://${token}.example`,
      phone: '613-555-0100',
      total_par: 72,
      holes_count: 18,
      hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 380 }, handicap: i + 1 })),
      course_rating: { white: 71.2 },
      slope_rating: { white: 128 },
    })
    .select('id')
    .single();
  expect(seedError, 'course seeded').toBeNull();
  const courseId = course!.id as string;

  await admin.from('club_requests').delete().eq('requester_profile_id', userB.id);
  await resetRateBucket(admin, 'club-request', userB.id);

  const ctx = await page.context().browser()!.newContext({
    storageState: 'e2e/.auth/state-b.json',
    viewport: { width: 375, height: 812 },
  });
  const pageB = await ctx.newPage();
  try {
    await pageB.goto('/club/start?sport=golf');
    await expect(pageB.getByRole('heading', { name: 'Start a club' })).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText('Step 1 of 2')).toBeVisible();
    const scrollWidth = await pageB.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

    // The door's defaults: Golf checked, competitions on, teams off.
    await expect(pageB.getByRole('checkbox', { name: 'Golf' })).toBeChecked();
    await expect(pageB.getByRole('checkbox', { name: /We run competitions/ })).toBeChecked();
    await expect(pageB.getByRole('checkbox', { name: /We run teams/ })).not.toBeChecked();

    // The home course (optional): search → pick → prefills.
    await pageB.getByLabel('Home course (optional)').fill(token);
    const hit = pageB.getByRole('button', { name: new RegExp(clubName) });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();
    await expect(pageB.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(pageB.getByLabel('Name')).toHaveValue(clubName);
    await expect(pageB.getByLabel('Website')).toHaveValue(`https://${token}.example`);
    await expect(pageB.getByLabel('Phone')).toHaveValue('613-555-0100');
    // No place row on the seed → the hint, not a silent prefill.
    await expect(pageB.getByText(/is in Kanata, Ontario, Canada/)).toBeVisible();

    // Two steps: identity → review (structure and connections can wait).
    await pageB.getByRole('button', { name: 'Continue' }).click();
    await expect(pageB.getByText('Step 2 of 2')).toBeVisible();
    await expect(pageB.getByText(`Home course: ${clubName}`)).toBeVisible();
    await expect(pageB.getByText('Divisions, teams and connections can wait')).toBeVisible();

    // The escape hatch expands to the full flow, and the draft survives it.
    await pageB.getByRole('button', { name: 'Add divisions and teams now' }).click();
    await expect(pageB.getByText('Step 2 of 4')).toBeVisible();
    await pageB.getByRole('button', { name: 'Continue' }).click(); // structure (empty)
    await pageB.getByRole('button', { name: 'Continue' }).click(); // connections (empty)
    await expect(pageB.getByText('Step 4 of 4')).toBeVisible();
    await expect(pageB.getByText(`Home course: ${clubName}`)).toBeVisible();

    await pageB.getByRole('button', { name: 'Submit request' }).click();
    await expect(pageB.getByText(`${clubName} is waiting for review`)).toBeVisible({ timeout: 15_000 });

    // DB truth.
    const { data: rows } = await admin
      .from('club_requests')
      .select(hasSiteDraft ? 'status, operates_competitions, operates_teams, site_draft' : 'status, operates_competitions, operates_teams')
      .eq('requester_profile_id', userB.id)
      .eq('name', clubName);
    expect(rows).toHaveLength(1);
    const row = rows![0] as unknown as {
      status: string;
      operates_competitions: boolean;
      operates_teams: boolean;
      site_draft?: unknown;
    };
    expect(row.status).toBe('pending');
    expect(row.operates_competitions).toBe(true);
    expect(row.operates_teams).toBe(false);
    if (hasSiteDraft) {
      expect(row.site_draft).toEqual({
        sports: ['golf'],
        homeCourseId: courseId,
        contact: { website: `https://${token}.example`, phone: '613-555-0100' },
      });
    } else {
      console.warn('[club-request-golf] site_draft column missing — run migration 174; the fallback insert was exercised instead');
    }
  } finally {
    await admin.from('club_requests').delete().eq('requester_profile_id', userB.id);
    await admin.from('golf_courses').delete().eq('id', courseId);
    await ctx.close();
  }
});
