import { describe, expect, it } from 'vitest';
import { autoRosterDecision } from '../auto-roster';

describe('autoRosterDecision', () => {
  it('an unsupervised adult who consents is counted in one act', () => {
    expect(autoRosterDecision({ consent: true, supervised: false, liveEdgeStatus: null })).toBe('self_accept');
  });
  it('an adult with a pending offer on the table accepts it', () => {
    expect(autoRosterDecision({ consent: true, supervised: false, liveEdgeStatus: 'pending' })).toBe('self_accept');
  });
  it('a supervised athlete gets the guardian offer, never a self-accept', () => {
    expect(autoRosterDecision({ consent: true, supervised: true, liveEdgeStatus: null })).toBe('offer_pending');
    expect(autoRosterDecision({ consent: true, supervised: true, liveEdgeStatus: 'pending' })).toBe('skip');
  });
  it('already counted (active / placed / registered) → skip, both kinds of athlete', () => {
    for (const status of ['active', 'placed', 'registered', 'evaluating']) {
      expect(autoRosterDecision({ consent: true, supervised: false, liveEdgeStatus: status })).toBe('skip');
      expect(autoRosterDecision({ consent: true, supervised: true, liveEdgeStatus: status })).toBe('skip');
    }
  });
  it('no consent → nothing happens', () => {
    expect(autoRosterDecision({ consent: false, supervised: false, liveEdgeStatus: null })).toBe('skip');
    expect(autoRosterDecision({ consent: false, supervised: true, liveEdgeStatus: null })).toBe('skip');
  });
});
