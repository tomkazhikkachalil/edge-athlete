import { test, expect } from '@playwright/test';
import { createQaOrg } from './helpers/org';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, setGroups, startRound } from './helpers/sport-events';

/**
 * Events program, phase 2b (B1) — an org-hosted event counts toward one of
 * the org's competitions. A owns a QA club with a golf net league (the
 * golf-league-sync recipe) and a hockey fixture competition; A hosts a
 * two-round event for the club. PUT contest: the league → two contests
 * minted (one per round, "Round 1" / "Round 2", the round's date as the
 * window, A entered as a participant); again → idempotent; the hockey
 * competition → 400 by name; B (no org authority) → 403; null → the link
 * removed while no result exists. The golf-sync engine refuses an event
 * round's contest. Then (PR 9) round 1 is played and completed: the org's
 * results come from the EVENT's board as club_recorded, an opted-out
 * player counts with no golf round, the live round is stamped, and the
 * link can no longer be removed. Self-skips before 211.
 */
test('sport events API: counts toward — mint one contest per round, refuse by name, unlink, the engine guard', async () => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('contests').select('sport_event_round_id').limit(1);
  test.skip(!!probe.error, 'contests.sport_event_round_id missing — run migration 211');
  let clubId: string | null = null;
  let eventId: string | null = null;
  try {
    const club = await createQaOrg(admin, 'club', { name: `QA Counts Club ${s.stamp}`, owner_profile_id: s.userA.id });
    clubId = club.id;
    await admin.from('memberships').insert([
      { org_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'follow' },
      { org_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'roster' },
    ]);
    const { data: season } = await admin.from('seasons').insert({ org_id: clubId, label: `2030 ${s.stamp}` }).select('id').single();
    const { data: league } = await admin.from('competitions').insert({ org_id: clubId, season_id: season!.id, sport_key: 'golf', name: `Counts League ${s.stamp}`, format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_net', status: 'active', visibility: 'public' }).select('id').single();
    const { data: hockey } = await admin.from('competitions').insert({ org_id: clubId, season_id: season!.id, sport_key: 'ice_hockey', name: `Counts Hockey ${s.stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select('id').single();
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

    // PR 9: the results. B joins and opts out of their profile; round 1 goes live (the
    // contest reads in_progress), both score, the round completes with the override →
    // the contest is completed with club_recorded results from the EVENT's board, B's
    // roundRef.roundId null (no golf round for an opted-out player) yet counted, the
    // live round stamped with the contest, and the link can no longer be removed.
    const { participantId: rowBEvent, hostRowId } = await inviteAndAccept(s, eventId);
    expect((await s.apiB.patch(`/api/sport-events/${eventId}/participants/${rowBEvent}`, { data: { hide_from_profile: true } })).ok()).toBe(true);
    await setGroups(s.apiA, eventId, r1.id, [{ members: [hostRowId, rowBEvent] }]);
    const live = await startRound(s.apiA, eventId, r1.id, '2030-06-01');
    const gp = live.rounds[0].group_post_id as string;
    expect((await admin.from('contests').select('status').eq('id', contests![0].id).single()).data!.status).toBe('in_progress');
    const card = await readScorecard(s.apiA, gp);
    const holesFor = (strokes: number) => Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, strokes }));
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), holesFor(4));
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), holesFor(5));
    await completeRound(s.apiA, eventId, r1.id, true);
    const { data: results } = await admin.from('contest_results').select('participant_id, score, provenance, entered_by, payload').eq('contest_id', contests![0].id);
    expect(results).toHaveLength(2);
    for (const r of results!) expect(r.provenance).toBe('club_recorded');
    const byProfile = new Map((await admin.from('contest_participants').select('id, competition_entries!inner(profile_id)').eq('contest_id', contests![0].id)).data!.map(p => [((Array.isArray(p.competition_entries) ? p.competition_entries[0] : p.competition_entries) as { profile_id: string }).profile_id, p.id as string]));
    const resA = results!.find(r => r.participant_id === byProfile.get(s.userA.id))!;
    const resB = results!.find(r => r.participant_id === byProfile.get(s.userB.id))!;
    expect((resA.payload as { gross: number; roundRef: { roundId: string | null; groupPostId: string } }).gross).toBe(72);
    expect((resA.payload as { roundRef: { roundId: string | null } }).roundRef.roundId).toBeTruthy();
    expect((resB.payload as { gross: number }).gross).toBe(90);
    expect((resB.payload as { roundRef: { roundId: string | null; groupPostId: string } }).roundRef).toEqual({ roundId: null, groupPostId: gp });
    expect((await admin.from('golf_rounds').select('id', { count: 'exact', head: true }).eq('group_post_id', gp).eq('profile_id', s.userB.id)).count).toBe(0);
    expect((await admin.from('contests').select('status').eq('id', contests![0].id).single()).data!.status).toBe('completed');
    expect((await admin.from('group_posts').select('contest_id').eq('id', gp).single()).data!.contest_id).toBe(contests![0].id);
    const contestRes = await s.apiA.get(`/api/contests/${contests![0].id}`);
    expect(contestRes.status(), await readErrorBody(contestRes)).toBe(200);
    const entrants = ((await contestRes.json()) as { view: { entrants: Array<{ result: { score: number; provenance: string } | null }> } }).view.entrants;
    // The rule picks net when a net exists (A has an index) and gross otherwise (B has none) — the stored rows are the truth.
    expect(entrants.map(e => e.result?.score).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([resA.score, resB.score].sort((a, b) => a - b));
    expect((await admin.from('contest_results').select('id', { count: 'exact', head: true }).eq('contest_id', contests![1].id)).count).toBe(0);

    // The link cannot be removed once play began (the event is live; a completed
    // event answers the same) — the earlier refusal; `results_exist` guards the
    // draft / open window a result somehow reached.
    const unlinked = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: null } });
    expect(unlinked.status()).toBe(409);
    expect(((await unlinked.json()) as { reason: string }).reason).toBe('event_over');
    expect((await admin.from('contests').select('id', { count: 'exact', head: true }).eq('competition_id', leagueId)).count).toBe(2);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    await s.dispose();
  }
});

/**
 * PR 10 — the pickers and the places: an event created for the club WITH
 * `competition_id` carries "Hosted for" and "Counts toward" on its Overview
 * at 390; the row's link lands on the contest place, which reads "Played as
 * {event} · Round 1" and links back. Self-skips before 211.
 */
test('event page: Hosted for · Counts toward · the contest place says Played as @mobile', async ({ page }) => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('contests').select('sport_event_round_id').limit(1);
  test.skip(!!probe.error, 'contests.sport_event_round_id missing — run migration 211');
  let clubId: string | null = null;
  let eventId: string | null = null;
  try {
    const club = await createQaOrg(admin, 'club', { name: `QA Counts UI Club ${s.stamp}`, owner_profile_id: s.userA.id });
    clubId = club.id;
    await admin.from('memberships').insert([
      { org_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'follow' },
      { org_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'roster' },
    ]);
    const { data: season } = await admin.from('seasons').insert({ org_id: clubId, label: `2030 ${s.stamp}` }).select('id').single();
    const { data: league } = await admin.from('competitions').insert({ org_id: clubId, season_id: season!.id, sport_key: 'golf', name: `Counts UI League ${s.stamp}`, format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_gross', status: 'active', visibility: 'public' }).select('id').single();
    const created = await s.apiA.post('/api/sport-events', { data: { name: `QA Counts UI ${s.stamp}`, visibility: 'private', publish: true, club_id: clubId, competition_id: league!.id, round: { scheduled_on: '2030-06-01', course_name: 'QA Counts UI Links', holes: 9 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const view = (await created.json()) as { event: { id: string }; host_org: { name: string } | null; counts_toward: { competition_name: string; contests: Array<{ contest_id: string }> } | null };
    eventId = view.event.id;
    expect(view.host_org?.name).toBe(`QA Counts UI Club ${s.stamp}`);
    expect(view.counts_toward?.competition_name).toBe(`Counts UI League ${s.stamp}`);
    expect(view.counts_toward?.contests).toHaveLength(1);

    await page.goto(`/events/${eventId}?tab=overview`);
    await expect(page.locator('[data-event-hosted-for]')).toHaveText(`QA Counts UI Club ${s.stamp}`, { timeout: 20_000 });
    await expect(page.locator('[data-event-counts-toward]')).toHaveText(`Counts UI League ${s.stamp}`);
    await expect(page.locator('[data-event-counts-toward-open]')).toBeVisible();
    await page.locator('[data-event-counts-toward]').click();
    await expect(page).toHaveURL(new RegExp(`/event/${view.counts_toward!.contests[0].contest_id}`), { timeout: 20_000 });
    await expect(page.locator('[data-contest-played-as]')).toContainText(`Played as QA Counts UI ${s.stamp} · Round 1`, { timeout: 20_000 });
    await page.locator('[data-contest-played-as]').click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}`), { timeout: 20_000 });
  } finally {
    await cleanupEvent(s.apiA, eventId);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    await s.dispose();
  }
});
