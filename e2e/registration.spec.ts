import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, registrationFlagOnTarget } from './helpers/qa-user';

/** True once mig 163 widened the notifications CHECK (probe by insert —
 *  the FK-vs-CHECK error-code trick can't work here since user_id must be
 *  real; use the owner and clean up). */
async function registrationBellsAvailable(
  admin: ReturnType<typeof adminClient>,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('notifications')
    .insert({ user_id: userId, type: 'org_registration_received', title: 'probe', is_read: true })
    .select('id')
    .single();
  if (data?.id) await admin.from('notifications').delete().eq('id', data.id);
  return !error;
}

// Registration capture (phase 5 R2, migs 161+162): the family-initiated
// path. Window gates fail closed; the submit mints follow + the
// 'registered' org-roster row + the submission record with the
// eligibility snapshot; the collision matrix holds (invite-wins); the
// registrar list is gated and carries the answers; the transitions walk
// registered → evaluating → placed (team-scope row minted — THE
// attribution edge) → released. Runs API-level; the wizard UI is R3.
test('registration: window gate, submit, collisions, registrar transitions', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const athlete = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('registrations').select('id').limit(1);
  test.skip(!!probe.error, `registrations missing — run migration 162 (${probe.error?.message})`);
  const flagProbeApi = await apiAs('state.json');
  const flagOn = await registrationFlagOnTarget(flagProbeApi);
  await flagProbeApi.dispose();
  test.skip(!flagOn, 'FEATURE_ORG_REGISTRATION off on this target');

  const stamp = Date.now();
  const name = `QA Reg League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27', starts_on: '2026-09-01' })
      .select()
      .single();
    const seasonId = season!.id as string;
    const { data: division } = await admin
      .from('divisions')
      .insert({
        league_id: leagueId,
        season_id: seasonId,
        sport_key: 'ice_hockey',
        name: `U13 A ${stamp}`,
        age_band: 'U13',
        gender_stream: 'Mixed',
      })
      .select()
      .single();
    const divisionId = division!.id as string;
    const { data: team } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
      .select()
      .single();

    const regUrl = `/api/leagues/${leagueId}/registrations`;
    const athleteApi = await apiAs('state.json');
    const ownerApi = await apiAs('state-b.json');
    try {
      // CLOSED before any window exists (fail-safe).
      let res = await athleteApi.post(regUrl, {
        data: { seasonId, divisionId, answers: {} },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);

      // The registrar opens a season-wide window.
      res = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
        data: { seasonId, opensAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const windowId = ((await res.json()).window as { id: string }).id;

      // The family registers (adult self) — with the v1 answers.
      res = await athleteApi.post(regUrl, {
        data: {
          seasonId,
          divisionId,
          answers: {
            emergencyContact: { name: 'Pat Contact', phone: '555-0100' },
            medicalNotes: `peanut allergy ${stamp}`,
          },
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const submitted = await res.json();
      expect(submitted.status).toBe('registered');
      const registrationId = submitted.registration.id as string;

      // DB truth: follow + the 'registered' org-roster row with season_id.
      const { data: rosterRow } = await admin
        .from('memberships')
        .select('status, season_id, kind, scope_type')
        .eq('league_id', leagueId)
        .eq('profile_id', athlete.id)
        .eq('kind', 'roster')
        .single();
      expect(rosterRow).toMatchObject({
        status: 'registered',
        season_id: seasonId,
        scope_type: 'org',
      });

      // Collisions: same season 409; a manager invite over it 400.
      res = await athleteApi.post(regUrl, { data: { seasonId, divisionId, answers: {} } });
      expect(res.status(), await readErrorBody(res)).toBe(409);
      res = await ownerApi.post(`/api/leagues/${leagueId}/roster?profileId=${athlete.id}`);
      expect(res.status(), await readErrorBody(res)).toBe(400);

      // The registrar list carries the answers — and the family's own GET
      // of it is refused (manage_registration gate).
      res = await athleteApi.get(regUrl);
      expect(res.status(), await readErrorBody(res)).toBe(403);
      res = await ownerApi.get(`${regUrl}?seasonId=${seasonId}`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const list = (await res.json()).registrations as Array<Record<string, unknown>>;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ status: 'registered', divisionName: `U13 A ${stamp}` });
      expect(JSON.stringify(list[0].answers)).toContain(`peanut allergy ${stamp}`);

      // PR #492: the CSV export — same registrar gate, attachment
      // download, emergency contact included, MEDICAL NOTES EXCLUDED
      // (the console list stays the only medical-notes surface).
      res = await athleteApi.get(`${regUrl}/export`);
      expect(res.status(), 'family export refused').toBe(403);
      res = await ownerApi.get(`${regUrl}/export?seasonId=${seasonId}`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(res.headers()['content-type']).toContain('text/csv');
      expect(res.headers()['content-disposition']).toContain('attachment');
      const csv = await res.text();
      expect(csv.split('\n')[0]).toBe(
        'Athlete,Date of birth,Supervised,Offering,Status,Submitted,Emergency contact,Emergency phone,Eligibility flags'
      );
      expect(csv).toContain('Pat Contact');
      expect(csv).toContain(`U13 A ${stamp}`);
      expect(csv, 'medical notes must never reach a download').not.toContain('peanut allergy');

      // PR #492: a per-offering window with closesAt + capacity (the
      // console UI can now mint these). Season count is already 1, so a
      // capacity-1 division window refuses the next family as full —
      // the capacity check runs before collisions, so the body says so.
      const { data: division2 } = await admin
        .from('divisions')
        .insert({
          league_id: leagueId,
          season_id: seasonId,
          sport_key: 'ice_hockey',
          name: `U15 B ${stamp}`,
        })
        .select()
        .single();
      res = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
        data: {
          seasonId,
          divisionId: division2!.id,
          opensAt: new Date(Date.now() - 60_000).toISOString(),
          closesAt: new Date(Date.now() + 86_400_000).toISOString(),
          capacity: 1,
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const div2WindowId = ((await res.json()).window as { id: string }).id;
      res = await ownerApi.post(regUrl, {
        data: { seasonId, divisionId: division2!.id, answers: {} },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain('full');
      res = await ownerApi.delete(
        `/api/leagues/${leagueId}/registration-windows?windowId=${div2WindowId}`
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // R4: the received bell reached the org's manager (163-gated).
      const bellsOn = await registrationBellsAvailable(admin, owner.id);
      if (bellsOn) {
        const { data: received } = await admin
          .from('notifications')
          .select('id, type')
          .eq('user_id', owner.id)
          .eq('type', 'org_registration_received')
          .order('created_at', { ascending: false })
          .limit(1);
        expect(received, 'received bell for the manager').toHaveLength(1);
      }

      // R4: the registrar CONSOLE drives evaluate (UI), then the API
      // finishes place/release (both paths share the core).
      const transitionUrl = `${regUrl}/${registrationId}`;
      const { data: athleteProfile } = await admin
        .from('profiles')
        .select('display_name, full_name, first_name')
        .eq('id', athlete.id)
        .single();
      const athleteName =
        (athleteProfile!.display_name as string | null) ||
        (athleteProfile!.full_name as string | null) ||
        (athleteProfile!.first_name as string | null) ||
        'Athlete';
      const ctxOwner = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
      try {
        const page = await ctxOwner.newPage();
        await page.goto(`/app/org/league/${leagueId}`);
        await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
        const section = page.getByRole('region', { name: 'Registrations' });
        // PR #492: the open season-wide window renders as its own row
        // with a Close button (the old single toggle is gone).
        const windowsList = section.getByRole('list', { name: 'Registration windows' });
        await expect(windowsList.getByText('Season-wide')).toBeVisible({ timeout: 15_000 });
        await expect(windowsList.getByRole('button', { name: 'Close' }).first()).toBeVisible();
        await expect(section.getByText(athleteName).first()).toBeVisible();
        await section.getByRole('button', { name: 'Evaluate' }).click();
        await expect(section.getByText('Evaluating')).toBeVisible({ timeout: 15_000 });

        // 375px: the registrar section holds.
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(section.getByText('Evaluating')).toBeVisible();
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      } finally {
        await ctxOwner.close();
      }
      res = await ownerApi.patch(transitionUrl, {
        data: { action: 'place', teamId: team!.id },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      if (bellsOn) {
        const { data: placedBell } = await admin
          .from('notifications')
          .select('id')
          .eq('user_id', athlete.id)
          .eq('type', 'org_registration_placed')
          .limit(1);
        expect(placedBell, 'placed bell for the athlete').toHaveLength(1);
      }
      const { data: teamRow } = await admin
        .from('memberships')
        .select('status, season_id')
        .eq('league_id', leagueId)
        .eq('profile_id', athlete.id)
        .eq('kind', 'roster')
        .eq('scope_type', 'team')
        .eq('scope_id', team!.id)
        .single();
      expect(teamRow).toMatchObject({ status: 'active', season_id: seasonId });
      const { data: orgRow } = await admin
        .from('memberships')
        .select('status')
        .eq('league_id', leagueId)
        .eq('profile_id', athlete.id)
        .eq('kind', 'roster')
        .eq('scope_type', 'org')
        .single();
      expect(orgRow!.status).toBe('placed');

      // The family cannot run registrar transitions.
      res = await athleteApi.patch(transitionUrl, { data: { action: 'release' } });
      expect(res.status(), await readErrorBody(res)).toBe(403);

      // Release: org row 'released', team row gone, reason stamped.
      res = await ownerApi.patch(transitionUrl, {
        data: { action: 'release', reason: 'moved away' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const { data: afterRelease } = await admin
        .from('memberships')
        .select('status, scope_type')
        .eq('league_id', leagueId)
        .eq('profile_id', athlete.id)
        .eq('kind', 'roster');
      expect(afterRelease).toHaveLength(1);
      expect(afterRelease![0]).toMatchObject({ status: 'released', scope_type: 'org' });
      const { data: regRow } = await admin
        .from('registrations')
        .select('released_reason, released_by')
        .eq('id', registrationId)
        .single();
      expect(regRow).toMatchObject({ released_reason: 'moved away', released_by: owner.id });

      // Closing the window closes the door again.
      res = await ownerApi.delete(
        `/api/leagues/${leagueId}/registration-windows?windowId=${windowId}`
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const closed = await athleteApi.post(regUrl, {
        data: { seasonId, divisionId, answers: {} },
      });
      expect(closed.status(), await readErrorBody(closed)).toBe(409);
    } finally {
      await athleteApi.dispose();
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
