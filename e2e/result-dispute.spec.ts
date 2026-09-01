import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Result disputes (phase 6 R4, mig 168): a participating club raises,
// both orgs' managers are belled, the standings surfaces carry the
// unconfirmed marker, the owner resolves. Skips cleanly pre-168.

test('result dispute: raise by the club, bells both ways, owner resolves', async () => {
  test.setTimeout(300_000); // CDN settle can add ~2min vs prod
  const owner = loadQaUser('user-b.json'); // league owner (the competition authority)
  const clubManager = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('contest_results').select('disputed_by').limit(1);
  test.skip(!!probe.error, `dispute columns missing — run migration 168 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Dispute League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Dispute Club ${stamp}`, owner_profile_id: clubManager.id })
    .select()
    .single();
  const clubId = club!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
      { club_id: clubId, profile_id: clubManager.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27' })
      .select()
      .single();
    const { data: homeTeam } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Dispute Blazers ${stamp}` })
      .select()
      .single();
    const { data: awayTeam } = await admin
      .from('teams')
      .insert({ club_id: clubId, name: `Dispute Comets ${stamp}` })
      .select()
      .single();
    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `Dispute Cup ${stamp}`,
        format: 'fixture',
        entrant_type: 'team',
        status: 'active',
        visibility: 'public',
      })
      .select()
      .single();
    const compId = comp!.id as string;
    const { data: entries } = await admin
      .from('competition_entries')
      .insert([
        { competition_id: compId, team_id: homeTeam!.id, status: 'approved' },
        { competition_id: compId, team_id: awayTeam!.id, status: 'approved' },
      ])
      .select();
    const { data: contest } = await admin
      .from('contests')
      .insert({ competition_id: compId, status: 'scheduled' })
      .select()
      .single();
    const contestId = contest!.id as string;
    const { data: parts } = await admin
      .from('contest_participants')
      .insert([
        { contest_id: contestId, entry_id: entries![0].id, side: 'home' },
        { contest_id: contestId, entry_id: entries![1].id, side: 'away' },
      ])
      .select();

    const ownerApi = await apiAs('state-b.json');
    const clubApi = await apiAs('state.json');
    try {
      // The owner enters the result (3–2).
      let res = await ownerApi.post(`/api/leagues/${leagueId}/competitions/${compId}/results`, {
        data: {
          contestId,
          results: [
            { participantId: parts![0].id, score: 3 },
            { participantId: parts![1].id, score: 2 },
          ],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // A stranger org can't dispute; the participating CLUB can.
      res = await clubApi.patch(
        `/api/clubs/${clubId}/competitions/${compId}/results/dispute`,
        { data: { contestId, action: 'resolve' } }
      );
      expect(res.status(), 'club cannot resolve').toBe(403);
      res = await clubApi.patch(
        `/api/clubs/${clubId}/competitions/${compId}/results/dispute`,
        { data: { contestId, action: 'raise', note: `We recorded 3–3 ${stamp}` } }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Both result rows carry the state + note; the owner got the bell.
      const { data: rows } = await admin
        .from('contest_results')
        .select('dispute_status, dispute_note, disputed_by')
        .eq('contest_id', contestId);
      expect(rows).toHaveLength(2);
      for (const r of rows!) {
        expect(r.dispute_status).toBe('disputed');
        expect(r.dispute_note).toContain('3–3');
        expect(r.disputed_by).toBe(clubManager.id);
      }
      const { data: raisedBell } = await admin
        .from('notifications')
        .select('id')
        .eq('user_id', owner.id)
        .eq('type', 'contest_dispute_raised')
        .order('created_at', { ascending: false })
        .limit(1);
      expect(raisedBell, 'owner belled on raise').toHaveLength(1);

      // The standings payload footnotes the dispute (shared markup feeds
      // console twins + the public site).
      res = await ownerApi.get(`/api/leagues/${leagueId}/standings`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const standings = (await res.json()).competitions as {
        name: string;
        disputedCount: number;
      }[];
      const cup = standings.find(c => c.name === `Dispute Cup ${stamp}`);
      expect(cup?.disputedCount, 'disputed footnote count').toBe(1);

      // Detail GET shows disputed on the participants' result rows.
      res = await ownerApi.get(`/api/leagues/${leagueId}/competitions/${compId}`);
      const detail = await res.json();
      const detailContest = (detail.contests as {
        id: string;
        participants: { result: { dispute_status: string } | null }[];
      }[]).find(c => c.id === contestId);
      expect(detailContest?.participants[0]?.result?.dispute_status).toBe('disputed');

      // Resolve is the OWNER's act; the club is belled.
      res = await ownerApi.patch(
        `/api/leagues/${leagueId}/competitions/${compId}/results/dispute`,
        { data: { contestId, action: 'resolve' } }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const { data: resolvedRows } = await admin
        .from('contest_results')
        .select('dispute_status, resolved_by')
        .eq('contest_id', contestId)
        .limit(1);
      expect(resolvedRows![0]).toMatchObject({
        dispute_status: 'resolved',
        resolved_by: owner.id,
      });
      const { data: resolvedBell } = await admin
        .from('notifications')
        .select('id')
        .eq('user_id', clubManager.id)
        .eq('type', 'contest_dispute_resolved')
        .order('created_at', { ascending: false })
        .limit(1);
      expect(resolvedBell, 'club belled on resolve').toHaveLength(1);

      // The footnote clears once resolved. The standings API is
      // CDN-cached (s-maxage=60 + SWR) — vs prod the first post-resolve
      // read can serve the stale pre-resolve copy, so SETTLE on the
      // cleared count (the multi-POP lesson, standings-API edition).
      let clearedCount = -1;
      for (let attempt = 0; attempt < 14; attempt++) {
        res = await ownerApi.get(`/api/leagues/${leagueId}/standings`);
        const after = (await res.json()).competitions as { name: string; disputedCount: number }[];
        clearedCount = after.find(c => c.name === `Dispute Cup ${stamp}`)?.disputedCount ?? -1;
        if (clearedCount === 0) break;
        await new Promise(r => setTimeout(r, 8000));
      }
      expect(clearedCount, 'footnote cleared after resolve (CDN settled)').toBe(0);
    } finally {
      await ownerApi.dispose();
      await clubApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
