import { describe, it, expect } from 'vitest';
import { eventBackupStatus, orgBackupStatus } from '../authority/backup';
import { holdsAuthority } from '../moderation/state';

// Authority PR 2 (Sep 25 2026) — Tom: "there always needs to be two accounts"
// (a WARNING, never a block). A co-owner OR a manager backs up an org; an
// ACCEPTED co-organizer backs up an event; a moderated or departed account
// backs up nothing.
const all = (_id: string): boolean => true; // eslint-disable-line @typescript-eslint/no-unused-vars -- the holder signature

describe('eventBackupStatus', () => {
  const ev = (rows: Array<{ profileId: string; role: string; status: string }>, status = 'open', holds = all) =>
    eventBackupStatus({ status, hostProfileId: 'h', rows, holdsAuthority: holds });
  it('none with the host alone; ok with an accepted co-organizer', () => {
    expect(ev([{ profileId: 'h', role: 'organizer', status: 'accepted' }])).toBe('none');
    expect(ev([{ profileId: 'c', role: 'co_organizer', status: 'accepted' }])).toBe('ok');
  });
  it('an invited co-organizer is pending, not yet a backup', () => {
    expect(ev([{ profileId: 'c', role: 'co_organizer', status: 'invited' }])).toBe('pending');
  });
  it('a moderated co-organizer is no backup', () => {
    expect(ev([{ profileId: 'c', role: 'co_organizer', status: 'accepted' }], 'open', id => id !== 'c')).toBe('none');
  });
  it('a finished event needs none', () => {
    expect(ev([], 'completed')).toBe('n/a');
    expect(ev([], 'cancelled')).toBe('n/a');
  });
});

describe('orgBackupStatus', () => {
  const org = (rows: Array<{ profileId: string; role: string; status: string }>, holds = all) => orgBackupStatus({ rows, holdsAuthority: holds });
  it('one owner is none; a co-owner or a manager is ok', () => {
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }])).toBe('none');
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }, { profileId: 'b', role: 'owner', status: 'active' }])).toBe('ok');
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }, { profileId: 'b', role: 'manager', status: 'active' }])).toBe('ok');
  });
  it('staff, a plain member, an inactive row or a moderated person do not count', () => {
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }, { profileId: 'b', role: 'member', status: 'active' }])).toBe('none');
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }, { profileId: 'b', role: 'manager', status: 'pending' }])).toBe('none');
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }, { profileId: 'b', role: 'manager', status: 'active' }], id => id !== 'b')).toBe('none');
  });
  it('the same person twice is still one person', () => {
    expect(org([{ profileId: 'a', role: 'owner', status: 'active' }, { profileId: 'a', role: 'manager', status: 'active' }])).toBe('none');
  });
});

describe('holdsAuthority', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  it('active holds; limited, suspended, banned and departed do not', () => {
    expect(holdsAuthority({ moderation_state: 'active' }, now)).toBe(true);
    expect(holdsAuthority({ moderation_state: null }, now)).toBe(true);
    expect(holdsAuthority({ moderation_state: 'limited' }, now)).toBe(false);
    expect(holdsAuthority({ moderation_state: 'suspended', moderation_until: '2026-10-01T00:00:00Z' }, now)).toBe(false);
    expect(holdsAuthority({ moderation_state: 'banned' }, now)).toBe(false);
    expect(holdsAuthority({ moderation_state: 'active', departed_at: '2026-09-01T00:00:00Z' }, now)).toBe(false);
  });
  it('an expired suspension holds again', () => {
    expect(holdsAuthority({ moderation_state: 'suspended', moderation_until: '2026-09-20T00:00:00Z' }, now)).toBe(true);
  });
});
