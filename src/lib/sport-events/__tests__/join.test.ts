import { describe, expect, it } from 'vitest';
import { freeSeats, isFull, nextWaitlistPosition, planCapacityChange, planJoin, planWaitlistPromotion, seatsTaken, type JoinContext, type ParticipantSnapshot } from '../join';

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
