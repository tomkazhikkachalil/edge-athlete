import { describe, it, expect } from 'vitest';
import { guardianAccountPredatesInvite } from '../guardian-invites';

// Round 1 PR 1: a guardian invite is claimable only by an account OLDER than
// the invite (the minor-mints-a-parent path). Fails closed on bad input;
// the non-guardian invite types are untouched.
describe('guardianAccountPredatesInvite', () => {
  const invite = '2026-09-20T12:00:00Z';
  it('older account passes, newer is refused, equal is refused', () => {
    expect(guardianAccountPredatesInvite('guardian_for_pending', '2026-09-20T11:59:59Z', invite)).toBe(true);
    expect(guardianAccountPredatesInvite('guardian_additional', '2026-09-20T12:00:01Z', invite)).toBe(false);
    expect(guardianAccountPredatesInvite('guardian_additional', invite, invite)).toBe(false);
  });
  it('fails closed on an unreadable timestamp', () => {
    expect(guardianAccountPredatesInvite('guardian_for_pending', undefined, invite)).toBe(false);
    expect(guardianAccountPredatesInvite('guardian_for_pending', '2026-09-20T11:00:00Z', null)).toBe(false);
    expect(guardianAccountPredatesInvite('guardian_for_pending', 'not a date', invite)).toBe(false);
  });
  it('the athlete activation and the transfer check are not guardian grants', () => {
    expect(guardianAccountPredatesInvite('athlete_activation', '2030-01-01T00:00:00Z', invite)).toBe(true);
    expect(guardianAccountPredatesInvite('transfer_contact_verify', undefined, invite)).toBe(true);
  });
});
