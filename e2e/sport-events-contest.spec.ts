import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, openEventSession } from './helpers/sport-events';

/**
 * Events program, phase 2b (B1) — an org-hosted event counts toward one of
 * the org's competitions. A owns a QA club with a golf net league (the
 * golf-league-sync recipe) and a hockey fixture competition; A hosts a
 * two-round event for the club. PUT contest: the league → two contests
 * minted (one per round, "Round 1" / "Round 2", the round's date as the
 * window, A entered as a participant); again → idempotent; the hockey
 * competition → 400 by name; B (no org authority) → 403; null → the link
 * removed while no result exists. The golf-sync engine refuses an event
 * round's contest. Self-skips before 211.
 */
test('sport events API: counts toward — mint one contest per round, refuse by name, unlink, the engine guard', async () => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('contests').select('sport_event_round_id').limit(1);
  test.skip(!!probe.error, 'contests.sport_event_round_id missing — run migration 211');
  let clubId: string | null = null;
  let eventId: string | null = null;
  try {
    const { data: club } = await admin.from('clubs').insert({ name: `QA Counts Club ${s.stamp}`, owner_profile_id: s.userA.id }).select('id').single();
    clubId = club!.id as string;
    await admin.from('memberships').insert([
      { club_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'follow' },
      { club_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'roster' },
    ]);
    const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2030 ${s.stamp}` }).select('id').single();
    const { data: league } = await admin.from('competitions').insert({ club_id: clubId, season_id: season!.id, sport_key: 'golf', name: `Counts League ${s.stamp}`, format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_net', status: 'active', visibility: 'public' }).select('id').single();
    const { data: hockey } = await admin.from('competitions').insert({ club_id: clubId, season_id: season!.id, sport_key: 'ice_hockey', name: `Counts Hockey ${s.stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select('id').single();
    const leagueId = league!.id as string;

    const view = await createEvent(s.apiA, { name: `QA Counts ${s.stamp}`, publish: true, club_id: clubId, rounds: [
      { scheduled_on: '2030-06-01', course_name: 'QA Counts Links', holes: 18, starting_hole: 1 },
      { scheduled_on: '2030-06-02', course_name: 'QA Counts Links', holes: 18, starting_hole: 1 },
    ] });
    eventId = view.event.id;
    const [r1, r2] = view.rounds;

    // The link: two contests, one per round, on the rounds' dates; A is a participant.
    const linked = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: leagueId } });
    expect(linked.status(), await readErrorBody(linked)).toBe(200);
    const body = (await linked.json()) as { counts_toward: { competition_id: string; contests: Array<{ round_id: string; contest_id: string }> } };
    expect(body.counts_toward.competition_id).toBe(leagueId);
    expect(body.counts_toward.contests.map(c => c.round_id).sort()).toEqual([r1.id, r2.id].sort());
    const { data: contests } = await admin.from('contests').select('id, round, holes, play_from, play_to, status, sport_event_round_id').eq('competition_id', leagueId).order('play_from');
    expect(contests!.map(c => [c.round, c.holes, c.play_from, c.play_to, c.status])).toEqual([['Round 1', 18, '2030-06-01', '2030-06-01', 'scheduled'], ['Round 2', 18, '2030-06-02', '2030-06-02', 'scheduled']]);
    const { data: parts } = await admin.from('contest_participants').select('contest_id, competition_entries!inner(profile_id, status)').in('contest_id', contests!.map(c => c.id));
    expect(parts).toHaveLength(2);
    // Idempotent.
    const again = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: leagueId } });
    expect(again.status()).toBe(200);
    expect((await admin.from('contests').select('id', { count: 'exact', head: true }).eq('competition_id', leagueId)).count).toBe(2);

    // The engine refuses an event round's contest.
    const sync = await s.apiA.post(`/api/clubs/${clubId}/competitions/${leagueId}/golf-sync`, { data: { contestId: contests![0].id } });
    expect(sync.status(), await readErrorBody(sync)).toBe(200);
    const reports = (await sync.json()) as { reports?: Array<{ blocked?: string }> } | Array<{ blocked?: string }>;
    const list = Array.isArray(reports) ? reports : (reports.reports ?? []);
    expect(JSON.stringify(list)).toContain('an event round');

    // Refusals by name.
    const wrong = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: hockey!.id } });
    expect(wrong.status()).toBe(400);
    expect(((await wrong.json()) as { reason: string }).reason).toBe('not_golf_leaderboard');
    const asB = await s.apiB.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: leagueId } });
    expect([403, 404]).toContain(asB.status());

    // Unlink while no result exists.
    const unlinked = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: null } });
    expect(unlinked.status(), await readErrorBody(unlinked)).toBe(200);
    expect((await admin.from('contests').select('id', { count: 'exact', head: true }).eq('competition_id', leagueId)).count).toBe(0);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    await s.dispose();
  }
});
