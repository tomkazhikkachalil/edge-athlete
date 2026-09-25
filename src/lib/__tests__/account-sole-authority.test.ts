import { describe, it, expect } from 'vitest';
import { soleAuthorityMessage, soleEventBlockers, soleOrgBlockers } from '../account-sole-authority';

// The backup-account guard (Sep 24 2026): you cannot delete your account
// while you are the only person able to run an unfinished event, a club or a
// league (Tom: "there always needs to be two accounts").

const ME = 'me';
const ev = (id: string, status: string, host = ME) => ({ id, name: `Event ${id}`, status, host_profile_id: host });
const row = (sport_event_id: string, profile_id: string, role = 'co_organizer', status = 'accepted') => ({ sport_event_id, profile_id, role, status });

describe('soleEventBlockers', () => {
  it('an unfinished event I host alone blocks', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'open')], organizerRows: [] }).map(b => b.id)).toEqual(['e1']);
  });

  it('an accepted co-organizer is the backup', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'live')], organizerRows: [row('e1', 'other')] })).toEqual([]);
  });

  it('an invited or declined co-organizer is not a backup yet', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'draft')], organizerRows: [row('e1', 'other', 'co_organizer', 'invited')] })).toHaveLength(1);
    expect(soleEventBlockers(ME, { events: [ev('e1', 'draft')], organizerRows: [row('e1', 'other', 'co_organizer', 'declined')] })).toHaveLength(1);
  });

  it('a plain participant is not a backup', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'open')], organizerRows: [row('e1', 'other', 'participant')] })).toHaveLength(1);
  });

  it('when someone else hosts, my organizer role is not sole', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'open', 'host')], organizerRows: [row('e1', ME, 'organizer')] })).toEqual([]);
  });

  it('a finished or cancelled event never blocks — its results stand alone', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'completed'), ev('e2', 'cancelled')], organizerRows: [] })).toEqual([]);
  });

  it('my own organizer row does not count as a backup', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'open')], organizerRows: [row('e1', ME, 'organizer')] })).toHaveLength(1);
  });
});

describe('soleOrgBlockers', () => {
  const orgs = [{ id: 'c1', name: 'Pine Valley', kind: 'club' }, { id: 'l1', name: 'Metro League', kind: 'league' }];
  it('an org with no other owner blocks, named by its kind', () => {
    const b = soleOrgBlockers(ME, { orgs, ownerRows: [{ org_id: 'c1', profile_id: ME }, { org_id: 'l1', profile_id: ME }] });
    expect(b).toEqual([{ kind: 'club', id: 'c1', name: 'Pine Valley' }, { kind: 'league', id: 'l1', name: 'Metro League' }]);
  });
  it('a co-owner is the backup', () => {
    expect(soleOrgBlockers(ME, { orgs: [orgs[0]], ownerRows: [{ org_id: 'c1', profile_id: ME }, { org_id: 'c1', profile_id: 'x' }] })).toEqual([]);
  });
});

describe('soleAuthorityMessage', () => {
  it('names one, two, or many things', () => {
    const b = (name: string) => ({ kind: 'event' as const, id: name, name });
    expect(soleAuthorityMessage([b('A')])).toContain('run A.');
    expect(soleAuthorityMessage([b('A'), b('B')])).toContain('run A and B.');
    expect(soleAuthorityMessage([b('A'), b('B'), b('C')])).toContain('run A, B and C.');
  });
});

// Authority PR 2: a MANAGER backs up an org (Tom), and a backup must hold
// authority — a moderated or departed account is no backup.
describe('the backup rules (Authority PR 2)', () => {
  it('a manager is the backup of an org', () => {
    const orgs = [{ id: 'c1', name: 'Pine Valley', kind: 'club' }];
    expect(soleOrgBlockers(ME, { orgs, ownerRows: [{ org_id: 'c1', profile_id: ME }, { org_id: 'c1', profile_id: 'mgr' }] })).toEqual([]);
  });
  it('a backup who cannot hold authority does not count', () => {
    const orgs = [{ id: 'c1', name: 'Pine Valley', kind: 'club' }];
    expect(soleOrgBlockers(ME, { orgs, ownerRows: [{ org_id: 'c1', profile_id: ME }, { org_id: 'c1', profile_id: 'x' }] }, id => id !== 'x')).toHaveLength(1);
    expect(soleEventBlockers(ME, { events: [ev('e1', 'open')], organizerRows: [row('e1', 'x')] }, id => id !== 'x')).toHaveLength(1);
  });
  it('a moderated host of someone else\'s event leaves my organizer role sole', () => {
    expect(soleEventBlockers(ME, { events: [ev('e1', 'open', 'host')], organizerRows: [row('e1', ME, 'organizer')] }, id => id !== 'host')).toHaveLength(1);
  });
  it('the message names a manager as a backup too', () => {
    expect(soleAuthorityMessage([{ kind: 'club', id: 'c', name: 'A' }])).toContain('co-organizer, co-owner or manager');
  });
});
