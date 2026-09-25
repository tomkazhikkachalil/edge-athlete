import { describe, it, expect } from 'vitest';
import { planRoleChange, type RoleChangeContext } from '../roles';

// Authority PR 2 (Sep 25 2026): the event's backup — a co-organizer — and
// the host handover. The host alone grants; a co-organizer never mints peers.
const base: RoleChangeContext = {
  eventStatus: 'open', actorIsHost: true, actorIsTarget: false,
  target: { role: 'participant', status: 'accepted', playing: true },
  targetHoldsAuthority: true,
};

describe('planRoleChange', () => {
  it('the host makes an accepted player a co-organizer', () => {
    expect(planRoleChange('make_co_organizer', base)).toEqual({ ok: true, kind: 'row', next: { role: 'co_organizer' } });
  });
  it('a follower becomes a co-organizer who does not play (the follower CHECK)', () => {
    expect(planRoleChange('make_co_organizer', { ...base, target: { role: 'follower', status: 'accepted', playing: false } })).toEqual({ ok: true, kind: 'row', next: { role: 'co_organizer', playing: false } });
  });
  it('a co-organizer cannot mint a peer', () => {
    expect(planRoleChange('make_co_organizer', { ...base, actorIsHost: false })).toMatchObject({ ok: false, status: 403 });
  });
  it('only someone who joined, and who holds authority, can be a co-organizer', () => {
    expect(planRoleChange('make_co_organizer', { ...base, target: { role: 'participant', status: 'invited', playing: true } })).toMatchObject({ ok: false, status: 409 });
    expect(planRoleChange('make_co_organizer', { ...base, targetHoldsAuthority: false })).toMatchObject({ ok: false, status: 409 });
  });
  it('the host returns a co-organizer to a player; a co-organizer steps down only themself', () => {
    const coorg = { ...base, target: { role: 'co_organizer' as const, status: 'accepted' as const, playing: true } };
    expect(planRoleChange('make_participant', coorg)).toMatchObject({ ok: true, next: { role: 'participant' } });
    expect(planRoleChange('make_participant', { ...coorg, actorIsHost: false })).toMatchObject({ ok: false, status: 403 });
    expect(planRoleChange('step_down', { ...coorg, actorIsHost: false, actorIsTarget: true })).toMatchObject({ ok: true, next: { role: 'participant' } });
    expect(planRoleChange('step_down', { ...coorg, actorIsHost: false, actorIsTarget: false })).toMatchObject({ ok: false, status: 403 });
  });
  it('the host hands over only to an accepted co-organizer who holds authority', () => {
    const coorg = { ...base, target: { role: 'co_organizer' as const, status: 'accepted' as const, playing: false } };
    expect(planRoleChange('make_host', coorg)).toEqual({ ok: true, kind: 'host' });
    expect(planRoleChange('make_host', base)).toMatchObject({ ok: false, status: 409 });
    expect(planRoleChange('make_host', { ...coorg, actorIsHost: false })).toMatchObject({ ok: false, status: 403 });
    expect(planRoleChange('make_host', { ...coorg, targetHoldsAuthority: false })).toMatchObject({ ok: false, status: 409 });
  });
  it('a cancelled event changes no roles', () => {
    expect(planRoleChange('make_co_organizer', { ...base, eventStatus: 'cancelled' })).toMatchObject({ ok: false, status: 409 });
  });
});
