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

// Authority PR 2 (Sep 25 2026): running an event needs an ACCEPTED organizer
// row — an invited, requested or waitlisted co-organizer is not a backup yet.
describe('managing needs an accepted row (Authority PR 2)', () => {
  it('an accepted co-organizer manages; an invited or waitlisted one does not', () => {
    const run = (status: NonNullable<AccessInput['participant']>['status']) =>
      resolveSportEventAccess({ event: base({ visibility: 'public' }), viewerId: 'c', presentedToken: null, participant: p('co_organizer', status) });
    expect(run('accepted')?.canManage).toBe(true);
    expect(run('invited')?.canManage).toBe(false);
    expect(run('waitlisted')?.canManage).toBe(false);
    expect(run('requested')?.canManage).toBe(false);
  });
});

// Authority PR 3 (Sep 25 2026): moderation strips event authority — Tom's
// rule. A limited / suspended / banned organizer still SEES the event but
// cannot run it; the role reads as a participant so every organizer branch drops.
describe('the moderation ceiling (Authority PR 3)', () => {
  it('a moderated host keeps viewing but cannot manage or delete', () => {
    const a = resolveSportEventAccess({ event: base(), viewerId: 'host', presentedToken: null, participant: p('organizer', 'accepted'), viewerHoldsAuthority: false });
    expect(a).toMatchObject({ canView: true, canManage: false, canDelete: false, role: 'participant', authorityPaused: true });
  });
  it('a moderated co-organizer of a private event is still admitted, as a participant', () => {
    const a = resolveSportEventAccess({ event: base({ visibility: 'private' }), viewerId: 'c', presentedToken: null, participant: p('co_organizer', 'accepted'), viewerHoldsAuthority: false });
    expect(a).toMatchObject({ canManage: false, role: 'participant', authorityPaused: true });
  });
  it('an active organizer is untouched; a moderated plain player has nothing to pause', () => {
    expect(resolveSportEventAccess({ event: base(), viewerId: 'host', presentedToken: null, participant: null })).toMatchObject({ canManage: true, canDelete: true, authorityPaused: false });
    expect(resolveSportEventAccess({ event: base({ visibility: 'public' }), viewerId: 'x', presentedToken: null, participant: p('participant', 'accepted'), viewerHoldsAuthority: false })).toMatchObject({ canManage: false, authorityPaused: false });
  });
});
