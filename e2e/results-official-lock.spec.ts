import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, setGroups, startRound } from './helpers/sport-events';

// ── Results-kept round PR 3 (241, Sep 26 2026): official results are locked ─
// Tom: an OFFICIAL result (a club / league event, an org competition, an
// org-recorded score) is never untagged or rewritten by its player — they may
// hide it from their profile — and "make sure individuals know if they've
// been untagged from an official result". A hosts a club event, B plays it:
// B cannot rewrite the mirrored round or untag themselves from the round's
// post, but can hide it (logged against the event). The club removes B's
// competition entry: B is told, and the club's log records it.

test('official results: no rewrite, no untag, hide allowed (logged); an org removal bells the athlete', async () => {
  test.setTimeout(240_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('golf_rounds').select('profile_hidden_at').limit(1);
  test.skip(!!probe.error, 'run migration 241');
  let clubId: string | null = null;
  let eventId: string | null = null;
  try {
    clubId = (await createQaOrg(admin, 'club', { name: `QA Official Club ${s.stamp}`, owner_profile_id: s.userA.id })).id;
    await admin.from('memberships').insert([{ org_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'follow' }]);

    // A club event: B plays, it completes.
    const view = await createEvent(s.apiA, { name: `QA Official ${s.stamp}`, publish: true, club_id: clubId, rounds: [{ scheduled_on: '2030-07-01', course_name: 'QA Official Links', holes: 18, starting_hole: 1 }] });
    eventId = view.event.id;
    const r1 = view.rounds[0];
    const { participantId: rowB, hostRowId } = await inviteAndAccept(s, eventId);
    await setGroups(s.apiA, eventId, r1.id, [{ members: [hostRowId, rowB] }]);
    const live = await startRound(s.apiA, eventId, r1.id, '2030-07-01');
    const gp = live.rounds[0].group_post_id as string;
    const card = await readScorecard(s.apiA, gp);
    const holes = (n: number) => Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, strokes: n }));
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), holes(4));
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), holes(6));
    await completeRound(s.apiA, eventId, r1.id, true);

    const { data: mirror } = await admin.from('golf_rounds').select('id').eq('group_post_id', gp).eq('profile_id', s.userB.id).single();
    const mirrorId = mirror!.id as string;

    // B cannot rewrite the official round.
    let res = await s.apiB.patch(`/api/golf/rounds/${mirrorId}`, { data: { holes: [] } });
    expect(res.status(), await readErrorBody(res)).toBe(409);
    expect((await res.json()).official).toBe(true);

    // B cannot untag themselves from the round's (official) post.
    const { data: roundPost } = await admin.from('posts').select('id').eq('sport_event_round_id', r1.id).single();
    await admin.from('posts').update({ tags: [s.userB.id] }).eq('id', roundPost!.id);
    res = await s.apiB.delete(`/api/tags?postId=${roundPost!.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(409);
    expect(((await admin.from('posts').select('tags').eq('id', roundPost!.id).single()).data?.tags as string[])).toContain(s.userB.id);

    // B CAN hide it from their profile — it stays on the record, and the hide is logged against the event.
    res = await s.apiB.delete(`/api/golf/rounds/${mirrorId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).hidden).toBe(true);
    expect((await admin.from('athlete_performances').select('id').eq('natural_key', `golf_round:${mirrorId}`)).data).toHaveLength(1);
    const { data: evLog } = await admin.from('authority_audit').select('action, target_profile_id').eq('subject_type', 'sport_event').eq('subject_id', eventId);
    expect((evLog ?? []).find(r => r.action === 'result_hidden')).toMatchObject({ target_profile_id: s.userB.id });

    // The club removes B's competition entry → B is told, and the club's log records it.
    const { data: season } = await admin.from('seasons').insert({ org_id: clubId, label: `2030 ${s.stamp}` }).select('id').single();
    const { data: comp } = await admin.from('competitions').insert({ org_id: clubId, season_id: season!.id, sport_key: 'golf', name: `Official League ${s.stamp}`, format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_net', status: 'active', visibility: 'public' }).select('id').single();
    const { data: entry } = await admin.from('competition_entries').insert({ competition_id: comp!.id, profile_id: s.userB.id, status: 'approved' }).select('id').single();
    res = await s.apiA.delete(`/api/clubs/${clubId}/competitions/entries?id=${entry!.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await expect.poll(async () => ((await admin.from('notifications').select('title').eq('user_id', s.userB.id).eq('type', 'authority_notice').ilike('title', `%QA Official Club ${s.stamp}%`)).data ?? []).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const { data: orgLog } = await admin.from('authority_audit').select('action, actor_profile_id, target_profile_id').eq('subject_type', 'org').eq('subject_id', clubId);
    expect((orgLog ?? []).find(r => r.action === 'official_tag_removed')).toMatchObject({ actor_profile_id: s.userA.id, target_profile_id: s.userB.id });
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await deleteQaOrgs(admin, [clubId]);
    await admin.from('notifications').delete().eq('type', 'authority_notice').in('user_id', [s.userA.id, s.userB.id]);
    await s.dispose();
  }
});
