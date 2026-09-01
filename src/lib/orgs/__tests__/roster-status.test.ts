import { describe, expect, it } from 'vitest';
import { parseRosterStatus, pickRosterEdge, type RosterEdge } from '../members';

describe('parseRosterStatus — the cast replacement (phase 5)', () => {
  it('accepts every lifecycle value', () => {
    for (const s of ['pending', 'active', 'registered', 'evaluating', 'placed', 'released']) {
      expect(parseRosterStatus(s)).toBe(s);
    }
  });

  it('reads unknown, null and undefined as null — never a mis-type', () => {
    expect(parseRosterStatus('future_value')).toBeNull();
    expect(parseRosterStatus('')).toBeNull();
    expect(parseRosterStatus(null)).toBeNull();
    expect(parseRosterStatus(undefined)).toBeNull();
  });
});

describe('pickRosterEdge — season row outranks the NULL-season row', () => {
  const invite: RosterEdge = { status: 'pending', seasonId: null };
  const legacy: RosterEdge = { status: 'active', seasonId: null };
  const registered: RosterEdge = { status: 'registered', seasonId: 's1' };
  const placed: RosterEdge = { status: 'placed', seasonId: 's2' };

  it('with no seasonId argument, a season-scoped edge wins over NULL-season', () => {
    expect(pickRosterEdge([legacy, registered])).toEqual(registered);
    expect(pickRosterEdge([registered, legacy])).toEqual(registered);
  });

  it('falls back to the NULL-season edge, then null', () => {
    expect(pickRosterEdge([invite])).toEqual(invite);
    expect(pickRosterEdge([])).toBeNull();
  });

  it('an explicit seasonId picks exactly that season (null = the NULL-season edge)', () => {
    expect(pickRosterEdge([invite, registered, placed], 's2')).toEqual(placed);
    expect(pickRosterEdge([invite, registered], null)).toEqual(invite);
    expect(pickRosterEdge([registered], null)).toBeNull();
    expect(pickRosterEdge([invite], 's9')).toBeNull();
  });
});
