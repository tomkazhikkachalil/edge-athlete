import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The sanctioning chain (phase 6 R3, mig 167): league↔league edges via
// /api/leagues/[id]/parents (the 118 matrix), the append-only
// sanction_grants history, and the payoff — a league_verified stat line
// whose club is sanctioned TWO hops up displays 'sanctioned' through the
// common-authority resolver. Skips cleanly pre-167.

test('sanction chain: handshake, grants history, 2-hop provenance upgrade', async () => {
  test.setTimeout(180_000);
  const childOwner = loadQaUser('user-b.json'); // owns league A (the competition)
  const parentOwner = loadQaUser('user.json'); // owns league B (the governing body)
  const admin = adminClient();

  const probe = await admin.from('league_affiliations').select('league_id').limit(1);
  test.skip(!!probe.error, `league_affiliations missing — run migration 167 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: leagueA, error: errA } = await admin
    .from('leagues')
    .insert({ name: `QA Chain KMHA ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: childOwner.id })
    .select()
    .single();
  expect(errA, errA?.message).toBeNull();
  const aId = leagueA!.id as string;
  const { data: leagueB } = await admin
    .from('leagues')
    .insert({ name: `QA Chain District ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: parentOwner.id })
    .select()
    .single();
  const bId = leagueB!.id as string;
  const { data: clubC } = await admin
    .from('clubs')
    .insert({ name: `QA Chain Club ${stamp}`, owner_profile_id: parentOwner.id })
    .select()
    .single();
  const cId = clubC!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: aId, profile_id: childOwner.id, role: 'owner' },
      { league_id: bId, profile_id: parentOwner.id, role: 'owner' },
      { club_id: cId, profile_id: parentOwner.id, role: 'owner' },
    ]);

    const childApi = await apiAs('state-b.json');
    const parentApi = await apiAs('state.json');
    try {
      // ── The handshake matrix ─────────────────────────────────────────
      // Child requests a parent (up); self-accept refused; parent accepts.
      let res = await childApi.post(`/api/leagues/${aId}/parents`, {
        data: { leagueId: bId, affiliationType: 'sanctioned_by', direction: 'up' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await childApi.patch(`/api/leagues/${aId}/parents`, {
        data: { leagueId: bId },
      });
      expect(res.status(), 'self-accept refused').toBe(403);
      res = await parentApi.patch(`/api/leagues/${bId}/parents`, {
        data: { leagueId: aId },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Duplicate request 409s; the GET splits by viewer.
      res = await childApi.post(`/api/leagues/${aId}/parents`, {
        data: { leagueId: bId, affiliationType: 'member_of', direction: 'up' },
      });
      expect(res.status()).toBe(409);
      res = await childApi.get(`/api/leagues/${aId}/parents`);
      const chain = await res.json();
      expect(chain.active).toHaveLength(1);
      expect(chain.active[0]).toMatchObject({ direction: 'up', affiliation_type: 'sanctioned_by' });

      // The grants history opened a league-grant row.
      const { data: leagueGrant } = await admin
        .from('sanction_grants')
        .select('id, revoked_at')
        .eq('grantor_league_id', bId)
        .eq('grantee_kind', 'league')
        .eq('grantee_id', aId)
        .is('revoked_at', null);
      expect(leagueGrant, 'open league grant').toHaveLength(1);

      // ── The 2-hop provenance payoff ──────────────────────────────────
      // Club C is sanctioned by B (the parent). A owns the competition:
      // A's ancestors {A,B} ∩ C's sanctioners {B} → 'sanctioned'.
      await admin.from('league_clubs').insert({
        league_id: bId,
        club_id: cId,
        status: 'active',
        initiated_by: 'league',
        affiliation_type: 'sanctioned_by',
        decided_at: new Date().toISOString(),
      });

      const { data: season } = await admin
        .from('seasons')
        .insert({ league_id: aId, label: '2026-27' })
        .select()
        .single();
      const { data: homeTeam } = await admin
        .from('teams')
        .insert({ league_id: aId, name: `Chain Blazers ${stamp}` })
        .select()
        .single();
      const { data: awayTeam } = await admin
        .from('teams')
        .insert({ club_id: cId, name: `Chain Comets ${stamp}` })
        .select()
        .single();
      await admin.from('memberships').insert([
        {
          club_id: cId,
          profile_id: parentOwner.id,
          kind: 'roster',
          status: 'active',
          scope_type: 'team',
          scope_id: awayTeam!.id,
        },
      ]);
      const { data: comp } = await admin
        .from('competitions')
        .insert({
          league_id: aId,
          season_id: season!.id,
          sport_key: 'ice_hockey',
          name: `Chain Cup ${stamp}`,
          format: 'fixture',
          entrant_type: 'team',
          status: 'active',
          visibility: 'public',
        })
        .select()
        .single();
      const { data: entries } = await admin
        .from('competition_entries')
        .insert([
          { competition_id: comp!.id, team_id: homeTeam!.id, status: 'approved' },
          { competition_id: comp!.id, team_id: awayTeam!.id, status: 'approved' },
        ])
        .select();
      const { data: contest } = await admin
        .from('contests')
        .insert({ competition_id: comp!.id, status: 'scheduled' })
        .select()
        .single();
      await admin.from('contest_participants').insert([
        { contest_id: contest!.id, entry_id: entries![0].id, side: 'home' },
        { contest_id: contest!.id, entry_id: entries![1].id, side: 'away' },
      ]);

      // A's owner (the competition authority) enters the line for the
      // club-C athlete → stored league_verified, displayed SANCTIONED.
      res = await childApi.post(
        `/api/leagues/${aId}/competitions/${comp!.id}/stat-lines`,
        {
          data: {
            contestId: contest!.id,
            lines: [
              {
                profileId: parentOwner.id,
                teamId: awayTeam!.id,
                stats: { goals: 2, assists: 1 },
              },
            ],
          },
        }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);

      res = await parentApi.get(
        `/api/sports/stat-lines?profileId=${parentOwner.id}&sport=ice_hockey`
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const official = (await res.json()).official as { competitionName: string; provenance: string }[];
      const line = official.find(l => l.competitionName === `Chain Cup ${stamp}`);
      expect(line, 'the chain line reached the profile').toBeTruthy();
      expect(line!.provenance, '2-hop upgrade through the chain').toBe('sanctioned');

      // ── Dissolve closes the grant ────────────────────────────────────
      res = await childApi.delete(`/api/leagues/${aId}/parents?leagueId=${bId}`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).action).toBe('dissolved');
      const { data: closedGrant } = await admin
        .from('sanction_grants')
        .select('revoked_at')
        .eq('grantor_league_id', bId)
        .eq('grantee_kind', 'league')
        .eq('grantee_id', aId)
        .order('granted_at', { ascending: false })
        .limit(1);
      expect(closedGrant?.[0]?.revoked_at, 'grant closed on dissolve').toBeTruthy();

      // With the chain gone the same line drops back to league_verified.
      res = await parentApi.get(
        `/api/sports/stat-lines?profileId=${parentOwner.id}&sport=ice_hockey`
      );
      const after = (await res.json()).official as { competitionName: string; provenance: string }[];
      expect(
        after.find(l => l.competitionName === `Chain Cup ${stamp}`)!.provenance,
        'chip downgrades when the chain dissolves (documented semantics)'
      ).toBe('league_verified');
    } finally {
      await childApi.dispose();
      await parentApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', aId);
    await admin.from('leagues').delete().eq('id', bId);
    await admin.from('clubs').delete().eq('id', cId);
    await admin.from('sanction_grants').delete().eq('grantor_league_id', bId);
  }
});
