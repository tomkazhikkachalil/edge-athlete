import { describe, expect, it } from 'vitest';
import { aheadOf, freeSeats, isFull, moveWaitlistTo, nextWaitlistPosition, planCapacityChange, planJoin, planWaitlistPromotion, repackWaitlist, seatsTaken, type JoinContext, type ParticipantSnapshot } from '../join';

let n = 0;
const row = (over: Partial<ParticipantSnapshot> = {}): ParticipantSnapshot => ({ id: `r${++n}`, profileId: `p${n}`, role: 'participant', status: 'accepted', playing: true, waitlistPosition: null, createdAt: `2026-09-16T00:00:${String(n).padStart(2, '0')}Z`, ...over });
const ctx = (over: Partial<JoinContext> = {}): JoinContext => ({ event: { status: 'open', joinMode: 'invite', capacity: null }, actorRole: 'viewer', row: null, rows: [], ...over });

describe('seats and the waitlist', () => {
  it('only accepted + playing take seats; followers and non-playing organizers never do', () => {
    const rows = [row(), row({ role: 'follower', playing: false }), row({ role: 'organizer', playing: false }), row({ status: 'waitlisted', waitlistPosition: 1 })];
    expect(seatsTaken(rows)).toBe(1);
    expect(isFull(rows, 1)).toBe(true);
    expect(isFull(rows, null)).toBe(false);
    expect(freeSeats(rows, 3)).toBe(2);
  });
  it('the next waitlist position follows the highest; promotion is lowest position first, as many as the room', () => {
    const rows = [row({ status: 'waitlisted', waitlistPosition: 2 }), row({ status: 'waitlisted', waitlistPosition: 1 }), row()];
    expect(nextWaitlistPosition(rows)).toBe(3);
    expect(planWaitlistPromotion(rows, 2)).toEqual([rows[1].id]);
    expect(planWaitlistPromotion(rows, 3)).toEqual([rows[1].id, rows[0].id]);
    expect(planWaitlistPromotion(rows, 1)).toEqual([]);
    expect(planCapacityChange(rows, null)).toEqual([rows[1].id, rows[0].id]); // no cap = everyone
  });
});

describe('planJoin', () => {
  it('invite: organizers only, not while live, never twice', () => {
    expect(planJoin('invite', ctx({ actorRole: 'viewer' }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('invite', ctx({ actorRole: 'organizer', event: { status: 'live', joinMode: 'invite', capacity: null } }))).toMatchObject({ ok: false, status: 409 });
    expect(planJoin('invite', ctx({ actorRole: 'co_organizer' }))).toMatchObject({ ok: true, create: true, next: { status: 'invited', role: 'participant' } });
    expect(planJoin('invite', ctx({ actorRole: 'organizer', row: row({ status: 'accepted' }) }))).toMatchObject({ ok: false, status: 409 });
    expect(planJoin('invite', ctx({ actorRole: 'organizer', row: row({ role: 'follower', status: 'accepted', playing: false }) }))).toMatchObject({ ok: true, next: { role: 'participant', status: 'invited', playing: true } });
  });
  it('request: only while open and in request mode; an invited player requesting simply accepts', () => {
    expect(planJoin('request', ctx())).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('request', ctx({ event: { status: 'draft', joinMode: 'request', capacity: null } }))).toMatchObject({ ok: false, status: 409 });
    expect(planJoin('request', ctx({ event: { status: 'open', joinMode: 'request', capacity: null } }))).toMatchObject({ ok: true, create: true, next: { status: 'requested' } });
    expect(planJoin('request', ctx({ event: { status: 'open', joinMode: 'request', capacity: null }, row: row({ status: 'invited' }) }))).toMatchObject({ ok: true, next: { status: 'accepted' } });
    expect(planJoin('request', ctx({ event: { status: 'open', joinMode: 'request', capacity: null }, row: row({ status: 'removed' }) }))).toMatchObject({ ok: false, status: 403 });
  });
  it('phase 4 — join: open events under join_mode open only; a follower converts, an invited player accepts, a removed row stays out, a full field waitlists, live offers follow', () => {
    const open = { status: 'open' as const, joinMode: 'open' as const, capacity: null };
    expect(planJoin('join', ctx({ event: open }))).toMatchObject({ ok: true, create: true, next: { role: 'participant', status: 'accepted', playing: true, accepted: true } });
    expect(planJoin('join', ctx({ event: { ...open, capacity: 1 }, rows: [row()] }))).toMatchObject({ ok: true, next: { status: 'waitlisted', waitlistPosition: 1 } });
    const follower = row({ role: 'follower', playing: false });
    expect(planJoin('join', ctx({ event: open, row: follower, rows: [follower] }))).toMatchObject({ ok: true, create: false, next: { role: 'participant', status: 'accepted', playing: true } });
    const invited = row({ status: 'invited' });
    expect(planJoin('join', ctx({ event: open, row: invited, rows: [invited] }))).toMatchObject({ ok: true, next: { status: 'accepted' } });
    expect(planJoin('join', ctx({ event: open, row: row({ status: 'removed' }) }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('join', ctx({ event: open, row: row() }))).toMatchObject({ ok: false, status: 409, error: 'You are already in.' });
    expect(planJoin('join', ctx({ event: { ...open, joinMode: 'request' } }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('join', ctx({ event: { ...open, joinMode: 'invite' } }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('join', ctx({ event: { ...open, status: 'live' } }))).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('follow') });
    expect(planJoin('join', ctx({ event: { ...open, status: 'draft' } }))).toMatchObject({ ok: false, status: 409 });
  });
  it('accept seats the player, or waitlists them when full; approve is the organizer twin', () => {
    const full = [row(), row()];
    expect(planJoin('accept', ctx({ row: row({ status: 'invited' }), rows: full, event: { status: 'open', joinMode: 'invite', capacity: 2 } }))).toMatchObject({ ok: true, next: { status: 'waitlisted', waitlistPosition: 1 } });
    expect(planJoin('accept', ctx({ row: row({ status: 'invited' }), rows: full, event: { status: 'open', joinMode: 'invite', capacity: 3 } }))).toMatchObject({ ok: true, next: { status: 'accepted', accepted: true } });
    expect(planJoin('accept', ctx({ row: row({ status: 'accepted' }) }))).toMatchObject({ ok: false, status: 409 });
    expect(planJoin('approve', ctx({ actorRole: 'viewer', row: row({ status: 'requested' }) }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('approve', ctx({ actorRole: 'organizer', row: row({ status: 'requested' }) }))).toMatchObject({ ok: true, next: { status: 'accepted' } });
  });
  it('decline, reject, remove and withdraw free a seat and promote the waitlist', () => {
    const waiting = row({ status: 'waitlisted', waitlistPosition: 1 });
    const me = row();
    const rows = [me, waiting];
    const cap = { status: 'open' as const, joinMode: 'invite' as const, capacity: 1 };
    expect(planJoin('withdraw', ctx({ row: me, rows, event: cap }))).toMatchObject({ ok: true, next: { status: 'withdrawn' }, promote: [waiting.id] });
    expect(planJoin('remove', ctx({ actorRole: 'organizer', row: me, rows, event: cap }))).toMatchObject({ ok: true, next: { status: 'removed' }, promote: [waiting.id] });
    expect(planJoin('remove', ctx({ actorRole: 'organizer', row: row({ role: 'organizer' }) }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('withdraw', ctx({ row: row({ role: 'organizer' }) }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('decline', ctx({ row: row({ status: 'invited' }) }))).toMatchObject({ ok: true, next: { status: 'declined' } });
    expect(planJoin('decline', ctx({ row: row({ status: 'requested' }) }))).toMatchObject({ ok: true, next: { status: 'withdrawn' } }); // cancelling my own request
    expect(planJoin('reject', ctx({ actorRole: 'organizer', row: row({ status: 'requested' }) }))).toMatchObject({ ok: true, next: { status: 'declined' } });
  });
  it('follow / unfollow never touch a seat; a terminal event refuses everything', () => {
    expect(planJoin('follow', ctx())).toMatchObject({ ok: true, create: true, next: { role: 'follower', status: 'accepted', playing: false } });
    expect(planJoin('follow', ctx({ row: row() }))).toMatchObject({ ok: false, status: 409 });
    expect(planJoin('unfollow', ctx({ row: row({ role: 'follower', playing: false }) }))).toMatchObject({ ok: true, delete: true });
    expect(planJoin('unfollow', ctx({ row: row() }))).toMatchObject({ ok: false, status: 409 });
    expect(planJoin('follow', ctx({ event: { status: 'completed', joinMode: 'invite', capacity: null } }))).toMatchObject({ ok: false, status: 409 });
  });
});

describe('the waitlist polish (phase 2)', () => {
  it('promote: organizers only, a waitlisted row only, seated now whatever the capacity', () => {
    const w = row({ status: 'waitlisted', waitlistPosition: 1 });
    const full = ctx({ actorRole: 'organizer', row: w, rows: [row(), w], event: { status: 'open', joinMode: 'invite', capacity: 1 } });
    expect(planJoin('promote', full)).toMatchObject({ ok: true, next: { status: 'accepted', waitlistPosition: null, accepted: true }, promote: [] });
    expect(planJoin('promote', { ...full, actorRole: 'participant' })).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('promote', { ...full, row: row() })).toMatchObject({ ok: false, status: 409 });
  });
  it('repack renumbers 1..n in position then arrival order and reports only the changed rows', () => {
    const a = row({ status: 'waitlisted', waitlistPosition: 4 });
    const b = row({ status: 'waitlisted', waitlistPosition: 7 });
    const c = row({ status: 'waitlisted', waitlistPosition: 1 });
    expect(repackWaitlist([row(), a, b, c])).toEqual([{ id: a.id, waitlistPosition: 2 }, { id: b.id, waitlistPosition: 3 }]);
    expect(repackWaitlist([c, row()])).toEqual([]);
  });
  it('moveWaitlistTo places a row at a 1-based spot (clamped) and returns the packed changes; aheadOf counts the queue in front', () => {
    const a = row({ status: 'waitlisted', waitlistPosition: 1 });
    const b = row({ status: 'waitlisted', waitlistPosition: 2 });
    const c = row({ status: 'waitlisted', waitlistPosition: 3 });
    const rows = [row(), a, b, c];
    expect(moveWaitlistTo(rows, c.id, 1)).toEqual([{ id: c.id, waitlistPosition: 1 }, { id: a.id, waitlistPosition: 2 }, { id: b.id, waitlistPosition: 3 }]);
    expect(moveWaitlistTo(rows, a.id, 99)).toEqual([{ id: b.id, waitlistPosition: 1 }, { id: c.id, waitlistPosition: 2 }, { id: a.id, waitlistPosition: 3 }]);
    expect(moveWaitlistTo(rows, a.id, 1)).toEqual([]);
    expect(moveWaitlistTo(rows, 'nope', 1)).toEqual([]);
    expect(aheadOf(rows, c.id)).toBe(2);
    expect(aheadOf(rows, a.id)).toBe(0);
    expect(aheadOf(rows, rows[0].id)).toBeNull();
  });
});

describe('the cut and the invite (phase 2)', () => {
  it('no invites once the cut has been made', () => {
    expect(planJoin('invite', ctx({ actorRole: 'organizer', cutDecided: true }))).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('cut') });
    expect(planJoin('invite', ctx({ actorRole: 'organizer', cutDecided: false }))).toMatchObject({ ok: true });
  });
});

// Authority PR 2 (Sep 25 2026): inviting the event's backup — a co-organizer.
describe('the co-organizer invite (Authority PR 2)', () => {
  it('only the host invites a co-organizer; a co-organizer cannot mint a peer', () => {
    const asCo = { role: 'co_organizer' as const, playing: true };
    expect(planJoin('invite', ctx({ actorRole: 'organizer', inviteAs: asCo }))).toMatchObject({ ok: true, next: { role: 'co_organizer', status: 'invited', playing: true } });
    expect(planJoin('invite', ctx({ actorRole: 'co_organizer', inviteAs: asCo }))).toMatchObject({ ok: false, status: 403 });
  });
  it('a co-organizer who does not play may be invited while live (no seat)', () => {
    const live = { status: 'live' as const, joinMode: 'invite' as const, capacity: null };
    expect(planJoin('invite', ctx({ event: live, actorRole: 'organizer', inviteAs: { role: 'co_organizer', playing: false } }))).toMatchObject({ ok: true, next: { role: 'co_organizer', playing: false } });
    expect(planJoin('invite', ctx({ event: live, actorRole: 'organizer', inviteAs: { role: 'co_organizer', playing: true } }))).toMatchObject({ ok: false, status: 409 });
  });
  it('someone already in is promoted from the roster, not re-invited', () => {
    expect(planJoin('invite', ctx({ actorRole: 'organizer', inviteAs: { role: 'co_organizer', playing: true }, row: row({ status: 'accepted' }) }))).toMatchObject({ ok: false, status: 409 });
  });
  it('an accept that takes no seat is never waitlisted, even when full', () => {
    const seated = [row(), row()];
    const invited = row({ status: 'invited', playing: false, role: 'co_organizer' });
    const plan = planJoin('accept', ctx({ event: { status: 'open', joinMode: 'invite', capacity: 2 }, row: invited, rows: [...seated, invited] }));
    expect(plan).toMatchObject({ ok: true, next: { status: 'accepted', accepted: true } });
  });
  it('only the host removes a co-organizer', () => {
    const co = row({ role: 'co_organizer' });
    expect(planJoin('remove', ctx({ actorRole: 'co_organizer', row: co, rows: [co] }))).toMatchObject({ ok: false, status: 403 });
    expect(planJoin('remove', ctx({ actorRole: 'organizer', row: co, rows: [co] }))).toMatchObject({ ok: true, next: { status: 'removed' } });
  });
});
