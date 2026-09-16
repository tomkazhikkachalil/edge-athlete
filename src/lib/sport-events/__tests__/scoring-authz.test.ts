import { describe, expect, it } from 'vitest';
import { holeNumberInRange, scoringRight, type ScoringRightInput } from '../scoring-authz';

const base = (over: Partial<ScoringRightInput> = {}): ScoringRightInput => ({ viewerId: 'v', ownerProfileId: 'o', roundCreatorId: 'c', eventRole: 'participant', sameGroup: false, card: { status: 'in_progress' }, ...over });

describe('scoringRight — phase 4: recorders and self_entry', () => {
  it('a recorder writes any in-progress or submitted card on the admin client, never a final one', () => {
    expect(scoringRight(base({ recorder: true }))).toMatchObject({ allowed: true, via: 'recorder', client: 'admin', reopens: false });
    expect(scoringRight(base({ recorder: true, card: { status: 'submitted' } }))).toMatchObject({ allowed: true, via: 'recorder', client: 'admin', reopens: false });
    expect(scoringRight(base({ recorder: true, card: { status: 'final' } }))).toMatchObject({ allowed: false, status: 409 });
  });
  it('self_entry false: the owner and a partner are refused by name (recorder_only); organizers, the creator and recorders still write', () => {
    expect(scoringRight(base({ viewerId: 'o', selfEntry: false }))).toMatchObject({ allowed: false, status: 403, reason: 'recorder_only' });
    expect(scoringRight(base({ viewerId: 'o', selfEntry: false, card: { status: 'submitted' } }))).toMatchObject({ allowed: false, status: 403, reason: 'recorder_only' });
    expect(scoringRight(base({ sameGroup: true, selfEntry: false }))).toMatchObject({ allowed: false, status: 403, reason: 'recorder_only' });
    expect(scoringRight(base({ viewerId: 'c', selfEntry: false }))).toMatchObject({ allowed: true, via: 'creator' });
    expect(scoringRight(base({ eventRole: 'organizer', selfEntry: false }))).toMatchObject({ allowed: true, via: 'organizer' });
    expect(scoringRight(base({ recorder: true, selfEntry: false }))).toMatchObject({ allowed: true, via: 'recorder' });
    // A recorder who is also the owner enters their own card under self_entry false — as a recorder.
    expect(scoringRight(base({ viewerId: 'o', recorder: true, selfEntry: false }))).toMatchObject({ allowed: true, via: 'recorder' });
  });
  it('the defaults keep phase 1: no recorder, self entry on', () => {
    expect(scoringRight(base({ viewerId: 'o' }))).toMatchObject({ allowed: true, via: 'self' });
    expect(scoringRight(base({ sameGroup: true }))).toMatchObject({ allowed: true, via: 'groupmate' });
  });
});

describe('scoringRight — the via / client matrix', () => {
  it('in progress: self and the creator on the session client; organizers and group-mates on the admin client; strangers refused', () => {
    expect(scoringRight(base({ viewerId: 'o' }))).toMatchObject({ allowed: true, via: 'self', client: 'session' });
    expect(scoringRight(base({ viewerId: 'c' }))).toMatchObject({ allowed: true, via: 'creator', client: 'session' });
    expect(scoringRight(base({ eventRole: 'co_organizer' }))).toMatchObject({ allowed: true, via: 'organizer', client: 'admin' });
    expect(scoringRight(base({ sameGroup: true }))).toMatchObject({ allowed: true, via: 'groupmate', client: 'admin' });
    expect(scoringRight(base())).toMatchObject({ allowed: false, status: 403 });
  });
  it('submitted: the owner reopens, organizers and the creator may write, a group-mate may not', () => {
    const c = { status: 'submitted' as const };
    expect(scoringRight(base({ viewerId: 'o', card: c }))).toMatchObject({ allowed: true, via: 'self', reopens: true });
    expect(scoringRight(base({ eventRole: 'organizer', card: c }))).toMatchObject({ allowed: true, via: 'organizer' });
    expect(scoringRight(base({ viewerId: 'c', card: c }))).toMatchObject({ allowed: true, via: 'creator' });
    expect(scoringRight(base({ sameGroup: true, card: c }))).toMatchObject({ allowed: false, status: 409 });
  });
  it('final: organizers only — the owner and the creator are refused', () => {
    const c = { status: 'final' as const };
    expect(scoringRight(base({ viewerId: 'o', card: c }))).toMatchObject({ allowed: false, status: 409 });
    expect(scoringRight(base({ viewerId: 'c', card: c, eventRole: 'participant' }))).toMatchObject({ allowed: false, status: 409 });
    expect(scoringRight(base({ viewerId: 'c', card: c, eventRole: 'organizer' }))).toMatchObject({ allowed: true, via: 'organizer', client: 'session' });
    expect(scoringRight(base({ card: c, eventRole: 'co_organizer' }))).toMatchObject({ allowed: true, client: 'admin' });
  });
});

describe('hole ranges', () => {
  it('holes run from the starting hole: a back nine accepts 10..18 and nothing else', () => {
    expect(holeNumberInRange(10, 10, 9)).toBe(true);
    expect(holeNumberInRange(18, 10, 9)).toBe(true);
    expect(holeNumberInRange(3, 10, 9)).toBe(false);
    expect(holeNumberInRange(19, 10, 9)).toBe(false);
    expect(holeNumberInRange(18, 1, 18)).toBe(true);
    expect(holeNumberInRange(0, 1, 18)).toBe(false);
    expect(holeNumberInRange(2.5, 1, 18)).toBe(false);
  });
});
