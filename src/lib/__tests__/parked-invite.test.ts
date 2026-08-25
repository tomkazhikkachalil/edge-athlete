import { describe, it, expect } from 'vitest';
import { parseParkedInvite, PARKED_INVITE_TTL_MS } from '../parked-invite';

const NOW = 1_756_000_000_000;

describe('parseParkedInvite', () => {
  it('round-trips a stored parked invite', () => {
    const raw = JSON.stringify({
      v: 1,
      savedAt: NOW - 1000,
      message: 'Ask your parent to finish setup.',
      inviteUrl: 'https://example.com/guardian/claim/abc',
    });
    expect(parseParkedInvite(raw, NOW)).toEqual({
      message: 'Ask your parent to finish setup.',
      inviteUrl: 'https://example.com/guardian/claim/abc',
    });
  });

  it('expires with the invite (7 days)', () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW - PARKED_INVITE_TTL_MS - 1, inviteUrl: 'x' });
    expect(parseParkedInvite(raw, NOW)).toBeNull();
  });

  it('tolerates a missing url (message-only parking) and junk fields', () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW, message: 42, inviteUrl: null });
    expect(parseParkedInvite(raw, NOW)).toEqual({ message: '', inviteUrl: null });
  });

  it('rejects garbage, wrong versions, and null', () => {
    expect(parseParkedInvite(null, NOW)).toBeNull();
    expect(parseParkedInvite('not json', NOW)).toBeNull();
    expect(parseParkedInvite(JSON.stringify({ v: 2, savedAt: NOW }), NOW)).toBeNull();
    expect(parseParkedInvite(JSON.stringify({ v: 1 }), NOW)).toBeNull();
  });
});
