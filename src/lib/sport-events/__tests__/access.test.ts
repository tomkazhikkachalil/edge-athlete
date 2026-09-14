import { describe, expect, it } from 'vitest';
import { resolveSportEventAccess, type AccessInput } from '../access';

const base = (over: Partial<AccessInput['event']> = {}): AccessInput['event'] => ({ hostProfileId: 'host', visibility: 'private', status: 'open', linkToken: 'tok', ...over });
const p = (role: AccessInput['participant'] extends infer T ? (T extends { role: infer R } ? R : never) : never, status: NonNullable<AccessInput['participant']>['status']) => ({ role, status });

describe('resolveSportEventAccess — the one gate', () => {
  it('the host always manages and deletes, whatever the visibility', () => {
    const a = resolveSportEventAccess({ event: base(), viewerId: 'host', presentedToken: null, participant: null });
    expect(a).toMatchObject({ canView: true, canManage: true, canDelete: true, role: 'organizer' });
  });
  it('public: everyone, anon included; nobody manages by default', () => {
    expect(resolveSportEventAccess({ event: base({ visibility: 'public' }), viewerId: null, presentedToken: null, participant: null })).toMatchObject({ canView: true, canManage: false, role: 'viewer' });
    expect(resolveSportEventAccess({ event: base({ visibility: 'public' }), viewerId: 'x', presentedToken: null, participant: null })!.canDelete).toBe(false);
  });
  it('link: the token or a participant row admits; a stranger without it is refused (null = 404)', () => {
    const ev = base({ visibility: 'link' });
    expect(resolveSportEventAccess({ event: ev, viewerId: null, presentedToken: 'tok', participant: null })).toMatchObject({ canView: true });
    expect(resolveSportEventAccess({ event: ev, viewerId: null, presentedToken: 'wrong', participant: null })).toBeNull();
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: null })).toBeNull();
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: p('participant', 'invited') })).toMatchObject({ canView: true, participantStatus: 'invited' });
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: p('participant', 'declined') })).toBeNull();
  });
  it('private: participants of any role incl. followers, invited / requested / waitlisted; declined and removed are out; the token means nothing', () => {
    const ev = base();
    for (const status of ['invited', 'requested', 'accepted', 'waitlisted', 'withdrawn'] as const) {
      expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: p('participant', status) }), status).toMatchObject({ canView: true });
    }
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: p('follower', 'accepted') })).toMatchObject({ canView: true, role: 'follower', canManage: false });
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: p('participant', 'declined') })).toBeNull();
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: null, participant: p('participant', 'removed') })).toBeNull();
    expect(resolveSportEventAccess({ event: ev, viewerId: 'x', presentedToken: 'tok', participant: null })).toBeNull();
    expect(resolveSportEventAccess({ event: ev, viewerId: null, presentedToken: null, participant: null })).toBeNull();
  });
  it('a co-organizer manages but cannot delete; a removed co-organizer manages nothing', () => {
    expect(resolveSportEventAccess({ event: base(), viewerId: 'c', presentedToken: null, participant: p('co_organizer', 'accepted') })).toMatchObject({ canManage: true, canDelete: false, role: 'co_organizer' });
    expect(resolveSportEventAccess({ event: base(), viewerId: 'c', presentedToken: null, participant: p('co_organizer', 'removed') })).toBeNull();
  });
});
