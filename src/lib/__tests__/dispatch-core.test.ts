import { describe, it, expect } from 'vitest';
import {
  resolveChannels,
  emailDelivered,
  type DeliveryResult,
} from '../notify/dispatch-core';

describe('resolveChannels', () => {
  it('urgent tier: email defaults ON (migration 135 stance — missing pref = enabled)', () => {
    expect(resolveChannels('urgent', {})).toEqual(['email']);
    expect(resolveChannels('urgent', { urgentEmailEnabled: true })).toEqual(['email']);
  });

  it('urgent tier: only an explicit false opts out', () => {
    expect(resolveChannels('urgent', { urgentEmailEnabled: false })).toEqual([]);
  });

  it('digest tier: email is opt-in (platform default false)', () => {
    expect(resolveChannels('digest', {})).toEqual([]);
    expect(resolveChannels('digest', { emailEnabled: false })).toEqual([]);
    expect(resolveChannels('digest', { emailEnabled: true })).toEqual(['email']);
  });

  it('tiers read their own boolean, never the other one', () => {
    expect(resolveChannels('digest', { urgentEmailEnabled: true })).toEqual([]);
    expect(resolveChannels('urgent', { emailEnabled: false })).toEqual(['email']);
  });

  it('sms is never resolved while unprovisioned', () => {
    for (const tier of ['urgent', 'digest'] as const) {
      expect(resolveChannels(tier, { emailEnabled: true, urgentEmailEnabled: true }))
        .not.toContain('sms');
    }
  });
});

describe('emailDelivered', () => {
  const r = (channel: DeliveryResult['channel'], sent: boolean): DeliveryResult => ({ channel, sent });

  it('true only when the email channel actually sent', () => {
    expect(emailDelivered([r('email', true)])).toBe(true);
    expect(emailDelivered([r('email', false)])).toBe(false);
    expect(emailDelivered([])).toBe(false);
  });

  it('a successful non-email channel does not satisfy the email question', () => {
    expect(emailDelivered([r('sms', true), r('email', false)])).toBe(false);
  });
});
