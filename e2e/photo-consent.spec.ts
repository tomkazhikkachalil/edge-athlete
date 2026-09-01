import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaChild,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody,
} from './helpers/qa-user';

// Photo consent (phase 4, round 4, mig 159): the per-org publication grant
// on the ORG-SCOPE roster row. An adult accepts a roster offer WITH
// consent in one PATCH; revokes it standalone; an org manager can neither
// write another member's consent nor see more than the tri-state; a
// guardian answers for a supervised child (whose ask surfaces in the
// guardian queue) — and a supervised profile's full name stays masked on
// crawlable surfaces regardless of visibility (unit-tested rule; the
// public-surface proof rides the R5 gallery sweep).
test('photo consent: adult accept+consent, revoke, org read-only, guardian path', async () => {
  test.setTimeout(180_000);
  const athlete = loadQaUser('user.json'); // adult athlete AND guardian
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('photo_consent').limit(1);
  test.skip(!!probe.error, `photo_consent missing — run migration 159 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Consent League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  let childId: string | null = null;

  try {
    // Owner manages; the athlete follows and holds a PENDING roster offer.
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
      { league_id: leagueId, profile_id: athlete.id, role: 'member' },
      {
        league_id: leagueId,
        profile_id: athlete.id,
        kind: 'roster',
        status: 'pending',
        scope_type: 'org',
      },
    ]);

    const rosterUrl = `/api/leagues/${leagueId}/roster`;
    const athleteApi = await apiAs('state.json');
    const ownerApi = await apiAs('state-b.json');
    try {
      // Adult accept WITH consent — one PATCH.
      let res = await athleteApi.patch(rosterUrl, {
        data: { action: 'accept', photoConsent: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect(await res.json()).toMatchObject({ action: 'accepted', photoConsentRecorded: true });
      let { data: row } = await admin
        .from('memberships')
        .select('photo_consent, photo_consent_by')
        .eq('league_id', leagueId)
        .eq('profile_id', athlete.id)
        .eq('kind', 'roster')
        .single();
      expect(row).toMatchObject({ photo_consent: true, photo_consent_by: athlete.id });

      // Standalone revoke.
      res = await athleteApi.patch(rosterUrl, {
        data: { action: 'set_photo_consent', consent: false },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      ({ data: row } = await admin
        .from('memberships')
        .select('photo_consent, photo_consent_by')
        .eq('league_id', leagueId)
        .eq('profile_id', athlete.id)
        .eq('kind', 'roster')
        .single());
      expect(row!.photo_consent).toBe(false);

      // The org manager cannot write another member's consent (the
      // acting-for gate: requireProfileRole refuses a non-guardian).
      res = await ownerApi.patch(rosterUrl, {
        data: { action: 'set_photo_consent', profileId: athlete.id, consent: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(403);

      // The manager SEES the tri-state on the member panel…
      res = await ownerApi.get(`/api/leagues/${leagueId}`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const managerView = (await res.json()).members as {
        profile_id: string;
        photoConsent: boolean | null;
      }[];
      expect(managerView.find(m => m.profile_id === athlete.id)!.photoConsent).toBe(false);

      // …while a plain member sees only their OWN answer.
      res = await athleteApi.get(`/api/leagues/${leagueId}`);
      const memberView = (await res.json()).members as {
        profile_id: string;
        photoConsent: boolean | null;
      }[];
      expect(memberView.find(m => m.profile_id === athlete.id)!.photoConsent).toBe(false);
      expect(memberView.find(m => m.profile_id === owner.id)!.photoConsent).toBeNull();

      // ── Guardian path (needs the guardian feature on this target) ────
      if (guardianFlagOn()) {
        childId = await createQaChild(athlete.id, {
          firstName: 'Consent',
          lastName: 'Kid',
          handle: `consentkid${stamp}`,
        });
        // Active roster row, consent never asked.
        await admin.from('memberships').insert({
          league_id: leagueId,
          profile_id: childId,
          kind: 'roster',
          status: 'active',
          scope_type: 'org',
        });

        // The ask surfaces in the guardian queue (the queue query rides
        // FEATURE_ROSTER_GUARDIAN_GATE — assert only when it's on here).
        const rosterGateOn = process.env.NEXT_PUBLIC_FEATURE_ROSTER_GUARDIAN_GATE === '1';
        res = await athleteApi.get('/api/guardian/queue');
        expect(res.status(), await readErrorBody(res)).toBe(200);
        const items = (await res.json()).items as { kind: string; athlete: { id: string } }[];
        if (rosterGateOn) {
          expect(
            items.some(i => i.kind === 'photo_consent' && i.athlete.id === childId),
            'photo_consent ask in the guardian queue'
          ).toBe(true);
        }

        // The guardian answers for the child.
        res = await athleteApi.patch(rosterUrl, {
          data: { action: 'set_photo_consent', profileId: childId, consent: true },
        });
        expect(res.status(), await readErrorBody(res)).toBe(200);
        const { data: childRow } = await admin
          .from('memberships')
          .select('photo_consent, photo_consent_by')
          .eq('league_id', leagueId)
          .eq('profile_id', childId)
          .eq('kind', 'roster')
          .single();
        expect(childRow).toMatchObject({ photo_consent: true, photo_consent_by: athlete.id });

        // Answered ⇒ the ask leaves the queue.
        res = await athleteApi.get('/api/guardian/queue');
        const after = (await res.json()).items as { kind: string; athlete: { id: string } }[];
        expect(after.some(i => i.kind === 'photo_consent' && i.athlete.id === childId)).toBe(false);
      }
    } finally {
      await athleteApi.dispose();
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    if (childId) await deleteQaUser(childId);
  }
});
