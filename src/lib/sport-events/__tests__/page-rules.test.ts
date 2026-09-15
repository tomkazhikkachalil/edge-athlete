import { describe, expect, it } from 'vitest';
import { fieldLine, formatDateOnly, holesLabel, joinLine } from '../format';
import { joinControl, type JoinStateInput } from '../join-state';
import { parseEventTab } from '../tabs';

describe('the event page rules', () => {
  it('tabs: unknown → overview; the four deep links parse', () => {
    expect(parseEventTab(null)).toBe('overview');
    expect(parseEventTab('players')).toBe('players');
    expect(parseEventTab('scorecard')).toBe('overview');
  });
  it('dates format from their parts (never the local parser); labels read as English', () => {
    expect(formatDateOnly('2030-06-01')).toBe('Jun 1, 2030');
    expect(formatDateOnly('2030-06-01', { weekday: true })).toBe('Sat, Jun 1, 2030');
    expect(formatDateOnly('2030-12-31')).toBe('Dec 31, 2030');
    expect(formatDateOnly(null)).toBe('');
    expect(holesLabel(9, 10)).toBe('9 holes from the 10th');
    expect(holesLabel(18, 1)).toBe('18 holes');
    expect(joinLine('request')).toBe('Open to requests');
    expect(fieldLine({ playing: 3, waitlisted: 1 }, 8)).toBe('3 of 8 playing · 1 waitlisted');
    expect(fieldLine({ playing: 3, waitlisted: 0 }, null)).toBe('3 playing');
  });
  it('the join control per viewer', () => {
    const base: JoinStateInput = { signedIn: true, canManage: false, role: 'viewer', participantStatus: null, playing: false, waitlistPosition: null, event: { status: 'open', joinMode: 'invite' } };
    expect(joinControl({ ...base, signedIn: false })).toEqual({ kind: 'none' });
    expect(joinControl({ ...base, canManage: true })).toEqual({ kind: 'manage' });
    expect(joinControl(base)).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, event: { status: 'open', joinMode: 'request' } })).toEqual({ kind: 'request' });
    expect(joinControl({ ...base, event: { status: 'draft', joinMode: 'request' } })).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'invited' })).toEqual({ kind: 'respond' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'requested' })).toEqual({ kind: 'requested' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'accepted', playing: true })).toEqual({ kind: 'in', playing: true });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'waitlisted', waitlistPosition: 2 })).toEqual({ kind: 'waitlisted', position: 2 });
    expect(joinControl({ ...base, role: 'follower', participantStatus: 'accepted' })).toEqual({ kind: 'following' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'withdrawn' })).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'removed', event: { status: 'open', joinMode: 'request' } })).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'invited', event: { status: 'completed', joinMode: 'invite' } })).toEqual({ kind: 'none' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'accepted', playing: true, event: { status: 'completed', joinMode: 'invite' } })).toEqual({ kind: 'in', playing: true });
  });
});
