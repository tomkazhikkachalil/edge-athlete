import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program, PR 5 — the API lifecycle to live and through completion:
 * A publishes (open), invites B who accepts, sets the groups, goes live (the
 * round is minted, B's scorecard GET carries the event context and the
 * group), B withdraws while live (the round row goes declined), completing
 * is refused until the cards are final, the override completes, the
 * completed event deletes and the round stays the players' round.
 */
type View = {
  event: { id: string; status: string; opened_at: string | null; went_live_at: string | null; completed_at: string | null };
  rounds: Array<{ id: string; status: string; group_post_id: string | null }>;
  participants: Array<{ id: string; profile_id: string; status: string; role: string }>;
  groups: Array<{ id: string; sequence: number; members: Array<{ participant_id: string; position: number }> }>;
  viewer: { participant_id: string | null };
};

test('sport events API: open → live → complete', async () => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let eventId: string | null = null;
  let groupPostId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', {
      data: { name: `QA Lifecycle ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 18 } },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    let view = (await created.json()) as View;
    eventId = view.event.id;
    expect(view.event.status).toBe('open');
    expect(view.event.opened_at).toBeTruthy();
    expect(view.rounds[0].group_post_id).toBeNull();
    const roundId = view.rounds[0].id;

    // Invite B, B accepts.
    const invited = await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } });
    expect(invited.ok(), await readErrorBody(invited)).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    const accepted = await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } });
    expect(accepted.ok(), await readErrorBody(accepted)).toBe(true);

    // Groups: B first, then A. A non-player is refused by name.
    const hostRow = asB.participants.find(p => p.role === 'organizer')!;
    const badGroups = await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups: [{ members: [hostRow.id, hostRow.id] }] } });
    expect(badGroups.status()).toBe(400);
    expect(await badGroups.text()).toContain('two groups');
    const groups = await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups: [{ name: 'Group A', members: [asB.viewer.participant_id, hostRow.id], starting_hole: 1 }] } });
    expect(groups.ok(), await readErrorBody(groups)).toBe(true);
    view = (await groups.json()) as View;
    expect(view.groups[0].members.map(m => m.participant_id)).toEqual([asB.viewer.participant_id, hostRow.id]);

    // A stranger cannot transition; B (a player) cannot either.
    expect((await apiB.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live' } })).status()).toBe(403);

    // Go live: the round is minted, the group_post is linked.
    const live = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    view = (await live.json()) as View;
    expect(view.event.status).toBe('live');
    expect(view.event.went_live_at).toBeTruthy();
    expect(view.rounds[0].status).toBe('live');
    groupPostId = view.rounds[0].group_post_id;
    expect(groupPostId).toBeTruthy();

    // Live is idempotent on the mint: a second go-live is a 409 (invalid transition), not a second round.
    const again = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live' } });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { reason: string }).reason).toBe('invalid_transition');

    // B's scorecard carries the event context, the group in order, and both players in mint order.
    const card = await apiB.get(`/api/group-posts/${groupPostId}/scorecard`);
    expect(card.ok(), await readErrorBody(card)).toBe(true);
    const scorecard = (await card.json()) as { scorecard: { group_post: { status: string; sport_event_round_id: string }; participants: Array<{ participant: { profile_id: string; role: string; status: string; position: number } }>; sport_event: { id: string; name: string; group: { members: Array<{ profile_id: string; position: number }> } | null } } };
    expect(scorecard.scorecard.group_post.sport_event_round_id).toBe(roundId);
    expect(scorecard.scorecard.sport_event).toMatchObject({ id: eventId, name: `QA Lifecycle ${stamp}` });
    expect(scorecard.scorecard.sport_event.group!.members.map(m => m.profile_id)).toEqual([userB.id, userA.id]);
    expect(scorecard.scorecard.participants.map(p => [p.participant.profile_id, p.participant.role])).toEqual([[userA.id, 'creator'], [userB.id, 'participant']]);

    // Editing the round or the groups is closed once live.
    expect((await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups: [] } })).status()).toBe(409);
    expect((await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}`, { data: { scheduled_on: '2030-06-02', course_name: 'X' } })).status()).toBe(409);

    // B withdraws while live → the round row is declined.
    const withdrew = await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'withdraw' } });
    expect(withdrew.ok(), await readErrorBody(withdrew)).toBe(true);
    const cardAfter = (await (await apiA.get(`/api/group-posts/${groupPostId}/scorecard`)).json()) as typeof scorecard;
    expect(cardAfter.scorecard.participants.find(p => p.participant.profile_id === userB.id)?.participant.status).toBe('declined');

    // Complete: refused while A's card is not final; the override completes and ends the round.
    const refused = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed' } });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason).toBe('cards_not_final');
    const completed = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } });
    expect(completed.ok(), await readErrorBody(completed)).toBe(true);
    view = (await completed.json()) as View;
    expect(view.event.status).toBe('completed');
    expect(view.event.completed_at).toBeTruthy();
    expect(view.rounds[0].status).toBe('completed');
    const cardDone = (await (await apiA.get(`/api/group-posts/${groupPostId}/scorecard`)).json()) as typeof scorecard;
    expect(cardDone.scorecard.group_post.status).toBe('completed');

    // A completed event deletes; the minted round detaches (203 SET NULL) and
    // stays the players' round — the QA teardown deletes it with A.
    const del = await apiA.delete(`/api/sport-events/${eventId}`);
    expect(del.ok(), await readErrorBody(del)).toBe(true);
    eventId = null;
    const after = await apiA.get(`/api/group-posts/${groupPostId}/scorecard`);
    expect(after.status()).toBe(200);
    expect(((await after.json()) as { scorecard: { sport_event: unknown; group_post: { sport_event_round_id: string | null } } }).scorecard).toMatchObject({ sport_event: null, group_post: { sport_event_round_id: null } });
  } finally {
    // Best-effort cleanup only — an assertion here would mask the real failure.
    if (eventId) {
      await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
