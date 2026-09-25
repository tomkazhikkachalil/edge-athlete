import { test, expect, request as pwRequest } from '@playwright/test';
import {
  E2E_BASE_URL, adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, loadQaUser,
  mintStorageState, readErrorBody, resetRateBucket,
} from './helpers/qa-user';
import { createQaOrg, deleteQaOrgs } from './helpers/org';

// ── Departed accounts (migration 238, Sep 24 2026) ───────────────────────────
// Tom's rule: a result that is part of a game, event, round, club or league
// OUTLIVES the person. An adult T plays a league competition (a result), hosts
// an event with partner B (both cards, completed), plays a shared round with B
// and a solo round alone, and asks to delete their account. Purged through the
// owner's door, T becomes a name-only TOMBSTONE: the league still lists T by
// full name, B's board and card are untouched, the event still names its host
// (as text), and everything personal is gone — the login, the handle, the
// profile page, the solo round, the ability to be messaged or followed. The
// second test is the backup-account guard: the ONLY owner of a club cannot
// delete their account until someone else can run it.
// Skips without E2E_ADMIN_EMAIL (an address in the target build's ADMIN_EMAILS).
const adminEmail = adminEmailForE2E();

type View = {
  event: { id: string; status: string; host_profile_id: string };
  rounds: Array<{ id: string; group_post_id: string | null }>;
  participants: Array<{ id: string; profile_id: string; role: string; name: string; departed?: boolean; handle: string | null }>;
  viewer: { participant_id: string | null };
};
type Board = { rows: Array<{ profileId: string; gross: number | null; thru: number; cardStatus: string }> };

test('an adult with results departs as a name-only tombstone; other players\' results stand', async () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(240_000);
  const admin = adminClient();
  const stamp = Date.now();
  const fullName = `QA Departure ${stamp}`;
  const alpha = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');

  // T's first/last name ARE the QA name, so the stale-tombstone sweep can find it.
  const t = await createQaUser({ displayName: fullName, firstName: 'QA Departure', lastName: String(stamp) });
  const apiT = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(t), extraHTTPHeaders: bypassHeaders() });
  const apiB = await apiAs('state-b.json');
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  const league = await createQaOrg(admin, 'league', { name: `QA Departure League ${stamp}`, sport_key: 'golf', owner_profile_id: alpha.id });
  let eventId: string | null = null;
  try {
    await resetRateBucket(admin, 'sport-event', t.id);
    await resetRateBucket(admin, 'sport-event-join', userB.id);
    await admin.from('profiles').update({ handle: `qa-dep-${stamp}` }).eq('id', t.id);

    // 1. A league result — an entry, a completed contest, a result, a standings row.
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `Departure ${stamp}` }).select('id').single();
    const { data: comp, error: compError } = await admin.from('competitions').insert({
      org_id: league.id, season_id: season!.id, sport_key: 'golf', name: `Departure Cup ${stamp}`,
      format: 'leaderboard', entrant_type: 'athlete', status: 'active', visibility: 'public',
    }).select('id').single();
    expect(compError, compError?.message).toBeNull();
    const { data: entry } = await admin.from('competition_entries').insert({ competition_id: comp!.id, profile_id: t.id, status: 'approved' }).select('id').single();
    const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'completed' }).select('id').single();
    const { data: cp } = await admin.from('contest_participants').insert({ contest_id: contest!.id, entry_id: entry!.id }).select('id').single();
    const { error: resultError } = await admin.from('contest_results').insert({ contest_id: contest!.id, participant_id: cp!.id, entered_by: t.id, payload: { gross: 72 } });
    expect(resultError, resultError?.message).toBeNull();
    const { error: standError } = await admin.from('competition_standings').insert({ competition_id: comp!.id, entry_id: entry!.id, rank: 1, points: 10, played: 1 });
    expect(standError, standError?.message).toBeNull();

    // 2. An event T hosts with B: nine holes, both cards, completed.
    const created = await apiT.post('/api/sport-events', {
      data: { name: `QA Departure Open ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: `QA Departure Course ${stamp}`, holes: 9, starting_hole: 1 } },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    let view = (await created.json()) as View;
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    expect((await apiT.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);
    const live = await apiT.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    view = (await live.json()) as View;
    const eventRoundGp = view.rounds[0].group_post_id!;
    const card = (await (await apiT.get(`/api/group-posts/${eventRoundGp}/scorecard`)).json()) as { scorecard: { participants: Array<{ participant: { id: string; profile_id: string } }> } };
    const rowT = card.scorecard.participants.find(p => p.participant.profile_id === t.id)!.participant.id;
    const rowB = card.scorecard.participants.find(p => p.participant.profile_id === userB.id)!.participant.id;
    expect((await apiT.post(`/api/golf/scorecards/${rowT}/scores`, { data: { scores: [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 5 }] } })).status()).toBe(201);
    expect((await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 1, strokes: 3 }, { hole_number: 2, strokes: 4 }] } })).status()).toBe(201);
    const completed = await apiT.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } });
    expect(completed.ok(), await readErrorBody(completed)).toBe(true);
    const boardBefore = ((await (await apiB.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`)).json()) as Board).rows;
    expect(boardBefore.map(r => [r.profileId, r.gross])).toEqual([[userB.id, 7], [t.id, 9]]);

    // 3. A shared round T created with B, and a solo round T played alone.
    const seedRound = async (withB: boolean) => {
      const { data: gp, error } = await admin.from('group_posts')
        .insert({ creator_id: t.id, type: 'golf_round', title: `QA dep round ${stamp}`, date: '2030-06-02', visibility: 'private', status: 'completed' })
        .select('id').single();
      expect(error, error?.message).toBeNull();
      await admin.from('group_post_participants').insert([
        { group_post_id: gp!.id, profile_id: t.id, status: 'confirmed', role: 'participant' },
        ...(withB ? [{ group_post_id: gp!.id, profile_id: userB.id, status: 'confirmed', role: 'participant' }] : []),
      ]);
      return gp!.id as string;
    };
    const sharedRound = await seedRound(true);
    const soloRound = await seedRound(false);

    // 4. A performance row of T's (the dataset keeps it, the link is severed).
    const { count: perfBefore } = await admin.from('athlete_performances').select('id', { count: 'exact', head: true }).eq('profile_id', t.id);

    // ── T asks to delete (the park), then the owner's door purges now ─────────
    await admin.from('profiles').update({ deletion_requested_at: new Date().toISOString(), visibility: 'private' }).eq('id', t.id);
    expect((await apiB.post('/api/admin/account-purge', { data: { profileId: t.id } })).status(), 'a non-admin is refused').toBe(403);
    const dry = await adminApi.post('/api/admin/account-purge', { data: { profileId: t.id } });
    expect(dry.ok(), await readErrorBody(dry)).toBe(true);
    const plan = await dry.json();
    expect(plan).toMatchObject({ dryRun: true, mode: 'tombstone' });
    expect(plan.tied.entries).toBe(1);
    expect(plan.tied.hostedEvents).toBe(1);
    expect(plan.tied.sharedRoundsCreated).toBeGreaterThanOrEqual(2); // the event's round + the shared round
    const purged = await adminApi.post('/api/admin/account-purge', { data: { profileId: t.id, dryRun: false } });
    expect(purged.ok(), await readErrorBody(purged)).toBe(true);
    expect(await purged.json()).toMatchObject({ dryRun: false, mode: 'tombstone' });

    // ── The tombstone: name only ──────────────────────────────────────────────
    const { data: tomb } = await admin.from('profiles').select('first_name, last_name, full_name, email, handle, visibility, avatar_url, departed_at, deletion_requested_at').eq('id', t.id).maybeSingle();
    expect(tomb, 'the row survives').toBeTruthy();
    expect(tomb).toMatchObject({ first_name: 'QA Departure', last_name: String(stamp), full_name: fullName, email: `${t.id}@departed.invalid`, handle: null, visibility: 'private', avatar_url: null, deletion_requested_at: null });
    expect(tomb!.departed_at).toBeTruthy();
    const { data: authUser } = await admin.auth.admin.getUserById(t.id);
    expect(authUser?.user ?? null, 'the login is gone').toBeNull();
    expect((await adminApi.post('/api/admin/account-purge', { data: { profileId: t.id } })).status(), 'a second purge is refused').toBe(409);

    // ── The league keeps its result, by full name ─────────────────────────────
    const { count: results } = await admin.from('contest_results').select('id', { count: 'exact', head: true }).eq('contest_id', contest!.id);
    expect(results).toBe(1);
    const pub = await (await apiB.get(`/api/leagues/${league.id}/standings?_cb=${Date.now()}`)).json() as { competitions: Array<{ id: string; rows: Array<{ entrant_name: string }> }> };
    const row = pub.competitions.find(c => c.id === comp!.id)?.rows?.[0];
    expect(row?.entrant_name, 'the standings show the full name, never "First L."').toBe(fullName);

    // ── B's event: the board, the card and the host's name stand ─────────────
    const boardAfter = ((await (await apiB.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`)).json()) as Board).rows;
    expect(boardAfter.map(r => [r.profileId, r.gross, r.cardStatus])).toEqual(boardBefore.map(r => [r.profileId, r.gross, r.cardStatus]));
    const viewAfter = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    const host = viewAfter.participants.find(p => p.profile_id === t.id)!;
    expect(host).toMatchObject({ name: fullName, departed: true, handle: null });

    // ── Shared round kept, solo round gone; T's posts: only the event's ──────
    expect((await admin.from('group_posts').select('id').eq('id', sharedRound).maybeSingle()).data, 'the shared round stays').toBeTruthy();
    expect((await admin.from('group_post_participants').select('id').eq('group_post_id', sharedRound).eq('profile_id', userB.id).maybeSingle()).data, 'B\'s card stays').toBeTruthy();
    expect((await admin.from('group_posts').select('id').eq('id', soloRound).maybeSingle()).data, 'the solo round goes').toBeNull();
    const { data: leftPosts } = await admin.from('posts').select('id, sport_event_round_id, group_post_id').eq('profile_id', t.id);
    for (const p of leftPosts ?? []) expect(p.sport_event_round_id || p.group_post_id === sharedRound, `post ${p.id} is a shared thing's`).toBeTruthy();

    // ── Nothing personal answers any more ────────────────────────────────────
    const profileRes = await apiB.get(`/api/profile?id=${t.id}`);
    expect(profileRes.status()).toBe(404);
    expect(await profileRes.json()).toMatchObject({ departed: true });
    expect((await apiB.get(`/api/public/profile?handle=qa-dep-${stamp}`)).status(), 'the handle is released').toBe(404);
    expect((await apiB.post('/api/messages', { data: { type: 'direct', participantId: t.id } })).status(), 'no one to message').toBe(404);
    const { count: searchDocs } = await admin.from('search_documents').select('entity_id', { count: 'exact', head: true }).eq('entity_type', 'athlete').eq('entity_id', t.id);
    expect(searchDocs, 'search forgot them').toBe(0);
    await admin.from('notifications').insert({ user_id: t.id, type: 'system_announcement', title: 'QA bell to a departed account', message: 'x' });
    const { count: bells } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', t.id);
    expect(bells, 'a bell to a departed recipient is dropped').toBe(0);

    // ── The dataset keeps the facts, severed ─────────────────────────────────
    const { count: perfAfter } = await admin.from('athlete_performances').select('id', { count: 'exact', head: true }).eq('profile_id', t.id);
    expect(perfAfter).toBe(0);
    if ((perfBefore ?? 0) > 0) {
      const { count: severed } = await admin.from('athlete_performances').select('id', { count: 'exact', head: true }).is('profile_id', null).like('natural_key', '%');
      expect(severed ?? 0).toBeGreaterThanOrEqual(perfBefore ?? 0);
    }
  } finally {
    // The QA data goes whole: the event (cascades its rounds and cards), the
    // league (its competition chain), then the tombstone and the admin user.
    // Each step on its own: a slow staging (statement timeout) must neither
    // mask the test's own result nor leak the steps after it — the global
    // teardown's registry and the 24 h sweep take whatever a step leaves.
    const step = (what: string, p: PromiseLike<unknown>) => Promise.resolve(p).catch(err => console.warn(`[account-departure cleanup] ${what}:`, (err as Error).message));
    if (eventId) await step('event', admin.from('sport_events').delete().eq('id', eventId));
    await step('league', deleteQaOrgs(admin, [league.id]));
    await step('tombstone', deleteQaUser(t.id));
    await step('admin user', deleteQaUser(adminUser.id));
    await Promise.all([apiT.dispose(), apiB.dispose(), adminApi.dispose()]);
  }
});

test('the only owner of a club cannot delete their account until someone else can run it', async () => {
  test.setTimeout(90_000);
  const admin = adminClient();
  const stamp = Date.now();
  const alpha = loadQaUser('user.json');
  const owner = await createQaUser({ displayName: `QA Sole Owner ${stamp}`, firstName: 'QA Sole', lastName: String(stamp) });
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders() });
  const club = await createQaOrg(admin, 'club', { name: `QA Sole Club ${stamp}`, owner_profile_id: owner.id });
  try {
    await resetRateBucket(admin, 'account-delete', owner.id);
    const member = (profileId: string, role: string) => ({ org_id: club.id, profile_id: profileId, kind: 'follow', role, status: 'active', scope_type: 'org', scope_id: null });
    const { error } = await admin.from('memberships').insert(member(owner.id, 'owner'));
    expect(error, error?.message).toBeNull();

    const refused = await api.delete('/api/account/delete', { data: { confirmText: owner.email, password: owner.password } });
    expect(refused.status(), await readErrorBody(refused)).toBe(409);
    const body = await refused.json();
    expect(body.soleAuthority.map((b: { id: string }) => b.id)).toEqual([club.id]);
    expect(body.error).toContain(`QA Sole Club ${stamp}`);
    const { data: stillLive } = await admin.from('profiles').select('deletion_requested_at').eq('id', owner.id).maybeSingle();
    expect(stillLive?.deletion_requested_at ?? null, 'nothing was parked').toBeNull();

    // A co-owner is the backup — now the delete parks the account.
    const { error: coError } = await admin.from('memberships').insert(member(alpha.id, 'owner'));
    expect(coError, coError?.message).toBeNull();
    const parked = await api.delete('/api/account/delete', { data: { confirmText: owner.email, password: owner.password } });
    expect(parked.ok(), await readErrorBody(parked)).toBe(true);
    const { data: nowParked } = await admin.from('profiles').select('deletion_requested_at').eq('id', owner.id).maybeSingle();
    expect(nowParked?.deletion_requested_at).toBeTruthy();
  } finally {
    await deleteQaOrgs(admin, [club.id]).catch(err => console.warn('[account-departure cleanup] club:', (err as Error).message));
    await deleteQaUser(owner.id).catch(() => {});
    await api.dispose();
  }
});
