import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, setGroups, startRound } from './helpers/sport-events';

// ── Results-kept round PR 4 (241, Sep 26 2026): "this result isn't me" ─────
// Tom: "They might have just tagged the wrong person, but the information
// could be correct. So it's important that the information not be lost. But
// the admin be able to tag the right person and correct any mistakes. Make
// sure individuals know." B plays a club event; B reports the result isn't
// theirs; C (a platform owner) moves it WHOLE to D — the event row, the card,
// the mirror, the dataset row, the org's contest — then corrects a hole, then
// removes it as a mistake. Everyone is told; every act is on the ticket.

type Panel = { results: Array<{ participantId: string; profileId: string; rounds: Array<{ cardId: string | null; gross: number | null }> }> };

test('wrong person: report → support moves the result to the right person, corrects it, removes a mistaken one', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await openEventSession();
  test.skip(!s.apiC || !s.userC || !s.userD, 'needs the four QA users');
  const admin = adminClient();
  const probe = await admin.from('golf_rounds').select('profile_hidden_at').limit(1);
  test.skip(!!probe.error, 'run migration 241');
  const apiC = s.apiC!;
  const userC = s.userC!;
  const userD = s.userD!;
  await resetRateBucket(admin, 'ticket-create', s.userB.id);
  await resetRateBucket(admin, 'authority-admin', userC.id);
  let clubId: string | null = null;
  let eventId: string | null = null;
  let ticketId: string | null = null;
  try {
    clubId = (await createQaOrg(admin, 'club', { name: `QA WrongPerson Club ${s.stamp}`, owner_profile_id: s.userA.id })).id;
    await admin.from('memberships').insert([{ org_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'follow' }]);
    const { data: season } = await admin.from('seasons').insert({ org_id: clubId, label: `2030 ${s.stamp}` }).select('id').single();
    const { data: comp } = await admin.from('competitions').insert({ org_id: clubId, season_id: season!.id, sport_key: 'golf', name: `WrongPerson League ${s.stamp}`, format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_gross', status: 'active', visibility: 'public' }).select('id').single();
    const view = await createEvent(s.apiA, { name: `QA WrongPerson ${s.stamp}`, publish: true, club_id: clubId, visibility: 'public', rounds: [{ scheduled_on: '2030-08-01', course_name: 'QA WP Links', holes: 18, starting_hole: 1 }] });
    eventId = view.event.id;
    const r1 = view.rounds[0];
    // The event counts toward the club's league (one contest per round).
    let res = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: comp!.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { participantId: rowB, hostRowId } = await inviteAndAccept(s, eventId);
    await setGroups(s.apiA, eventId, r1.id, [{ members: [hostRowId, rowB] }]);
    const live = await startRound(s.apiA, eventId, r1.id, '2030-08-01');
    const gp = live.rounds[0].group_post_id as string;
    const card = await readScorecard(s.apiA, gp);
    const holes = (n: number) => Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, strokes: n }));
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), holes(4));
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), holes(6));
    await completeRound(s.apiA, eventId, r1.id, true);
    const mirrorOf = async (profileId: string) => (await admin.from('golf_rounds').select('id, gross_score').eq('group_post_id', gp).eq('profile_id', profileId).maybeSingle()).data as { id: string; gross_score: number } | null;
    const bMirror = await mirrorOf(s.userB.id);
    expect(bMirror?.gross_score).toBe(108);

    // The door, at phone width: B (a player, not an organizer) sees "This result isn't me", which opens the sheet pre-picked.
    const phone = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await phone.newPage();
      await page.goto(`/events/${eventId}`);
      const door = page.locator('[data-event-wrong-person]');
      await expect(door).toBeVisible({ timeout: 20_000 });
      expect((await door.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await door.click();
      await expect(page.getByRole('radio', { name: /This result isn’t me/ })).toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    } finally {
      await phone.close();
    }

    // B: "this result isn't me" — a report on the event, the result snapshotted as it was.
    res = await s.apiB.post('/api/tickets', { data: { type: 'report', reason: 'wrong_person', description: 'I did not play this round — it was my brother.', target: { type: 'sport_event', id: eventId } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const ticket = (await res.json()) as { id: string; number: string };
    ticketId = ticket.id;
    const { data: t } = await admin.from('tickets').select('severity, target_profile_id, content_snapshot').eq('id', ticketId).single();
    expect(t).toMatchObject({ severity: 'medium', target_profile_id: null });
    expect(((t!.content_snapshot as { reporter_result?: { rounds: Array<{ gross: number }> } }).reporter_result?.rounds[0].gross)).toBe(108);

    // C (a platform owner) reads the event's results and moves B's to D.
    await admin.from('platform_admins').upsert({ profile_id: userC.id, role: 'owner' }, { onConflict: 'profile_id' });
    const panelUrl = `/api/admin/recovery/events/${eventId}`;
    const act = (body: Record<string, unknown>) => apiC.post(panelUrl, { data: { ticket: ticket.number, note: 'e2e: verified with both families', ...body } });
    let panel = (await (await apiC.get(panelUrl)).json()) as Panel;
    const bResult = panel.results.find(r => r.profileId === s.userB.id)!;
    expect(bResult.rounds[0].gross).toBe(108);
    res = await act({ action: 'reassign_result', participant: bResult.participantId, person: userD.id });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Moved WHOLE: the event row, the mirror, the dataset row — nothing recomputed, nothing lost.
    expect((await admin.from('sport_event_participants').select('profile_id').eq('id', bResult.participantId).single()).data?.profile_id).toBe(userD.id);
    expect(await mirrorOf(s.userB.id)).toBeNull();
    const dMirror = await mirrorOf(userD.id);
    expect(dMirror).toMatchObject({ id: bMirror!.id, gross_score: 108 });
    expect((await admin.from('athlete_performances').select('profile_id').eq('natural_key', `golf_round:${bMirror!.id}`).single()).data?.profile_id).toBe(userD.id);
    // The org's contest: the wrong person is off it, the right one is on it with the same score.
    const { data: contest } = await admin.from('contests').select('id').eq('sport_event_round_id', r1.id).single();
    const { data: parts } = await admin.from('contest_participants').select('id, competition_entries!inner(profile_id)').eq('contest_id', contest!.id);
    const partOf = new Map(((parts ?? []) as Array<{ id: string; competition_entries: { profile_id: string } | Array<{ profile_id: string }> }>).map(p => [(Array.isArray(p.competition_entries) ? p.competition_entries[0] : p.competition_entries).profile_id, p.id]));
    expect(partOf.has(s.userB.id), 'the wrong person is off the org’s contest').toBe(false);
    const { data: dResult } = await admin.from('contest_results').select('score').eq('participant_id', partOf.get(userD.id)!).single();
    expect(dResult?.score).toBe(108);
    // Both people are told.
    await expect.poll(async () => ((await admin.from('notifications').select('title').eq('user_id', s.userB.id).eq('type', 'authority_notice').ilike('title', '%moved off your profile%')).data ?? []).length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(((await admin.from('notifications').select('title').eq('user_id', userD.id).eq('type', 'authority_notice').ilike('title', '%added to your profile%')).data ?? []).length).toBeGreaterThan(0);

    // C corrects hole 1 (6 → 3): the mirror follows; the audit keeps before and after.
    panel = (await (await apiC.get(panelUrl)).json()) as Panel;
    const dCard = panel.results.find(r => r.profileId === userD.id)!.rounds[0].cardId!;
    res = await act({ action: 'correct_card', card: dCard, holes: [{ hole_number: 1, strokes: 3 }] });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await expect.poll(async () => (await mirrorOf(userD.id))?.gross_score, { timeout: 20_000 }).toBe(105);

    // C removes it as a mistaken result — the only true removal.
    res = await act({ action: 'remove_result', participant: bResult.participantId });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await mirrorOf(userD.id)).toBeNull();
    expect((await admin.from('sport_event_participants').select('status').eq('id', bResult.participantId).single()).data?.status).toBe('removed');

    // The record: three platform acts on the ticket, and three internal ticket steps.
    const { data: log } = await admin.from('authority_audit').select('action, actor_kind, ticket_id').eq('subject_type', 'sport_event').eq('subject_id', eventId).eq('actor_kind', 'platform');
    expect((log ?? []).map(r => r.action).sort()).toEqual(['result_corrected', 'result_corrected', 'result_reassigned']);
    for (const r of log ?? []) expect(r.ticket_id).toBe(ticketId);
    const { data: steps } = await admin.from('ticket_events').select('new_value').eq('ticket_id', ticketId).eq('kind', 'action_taken');
    expect((steps ?? []).map(x => x.new_value).sort()).toEqual(['result_corrected', 'result_reassigned', 'result_removed']);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await deleteQaOrgs(admin, [clubId]);
    if (ticketId) await admin.from('tickets').delete().eq('id', ticketId);
    await admin.from('platform_admins').delete().eq('profile_id', userC.id);
    await admin.from('notifications').delete().eq('type', 'authority_notice').in('user_id', [s.userA.id, s.userB.id, userC.id, userD.id]);
    await s.dispose();
  }
});
