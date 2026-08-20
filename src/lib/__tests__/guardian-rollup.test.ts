import { describe, it, expect } from 'vitest';
import {
  buildAthleteSummaries,
  consentChip,
  loginChip,
  messagingChip,
  visibilityChip,
} from '../guardian-rollup';
import type { ConsentState } from '../consent';

const A = 'athlete-a';
const B = 'athlete-b';

describe('buildAthleteSummaries', () => {
  it('empty ids → empty map', () => {
    expect(buildAthleteSummaries([], [], [], [], [])).toEqual({});
  });

  it('athlete with no rows anywhere gets the restrictive defaults', () => {
    expect(buildAthleteSummaries([A], [], [], [], [])).toEqual({
      [A]: {
        consentState: 'none',
        hasLogin: false,
        pendingPostCount: 0,
        activeTransfer: null,
      },
    });
  });

  it('latest consent action wins — rows arrive created_at DESC', () => {
    const s = buildAthleteSummaries(
      [A],
      [
        { profile_id: A, action: 'review_approved' }, // newest
        { profile_id: A, action: 'granted' },
        { profile_id: A, action: 'review_rejected' },
      ],
      [], [], []
    );
    expect(s[A].consentState).toBe('approved');
  });

  it('consent rows for unknown profiles are ignored', () => {
    const s = buildAthleteSummaries([A], [{ profile_id: B, action: 'granted' }], [], [], []);
    expect(s[A].consentState).toBe('none');
  });

  it('hasLogin requires a SELF supervised row — a supervised row pointing elsewhere never counts', () => {
    const s = buildAthleteSummaries(
      [A, B],
      [],
      [
        { user_id: A, profile_id: A },  // real credentials for A
        { user_id: A, profile_id: B },  // NOT credentials for B
      ],
      [], []
    );
    expect(s[A].hasLogin).toBe(true);
    expect(s[B].hasLogin).toBe(false);
  });

  it('pending posts group and count per athlete', () => {
    const s = buildAthleteSummaries(
      [A, B],
      [], [],
      [{ profile_id: A }, { profile_id: A }, { profile_id: B }],
      []
    );
    expect(s[A].pendingPostCount).toBe(2);
    expect(s[B].pendingPostCount).toBe(1);
  });

  it('active transfer state passes through; absent → null', () => {
    const s = buildAthleteSummaries(
      [A, B],
      [], [], [],
      [{ profile_id: A, state: 'dual_confirm' }]
    );
    expect(s[A].activeTransfer).toEqual({ state: 'dual_confirm' });
    expect(s[B].activeTransfer).toBeNull();
  });
});

describe('chips', () => {
  it('every consent state maps, amber only where the guardian must act', () => {
    const expected: Record<ConsentState, { tone: string }> = {
      none: { tone: 'amber' },
      rejected: { tone: 'amber' },
      pending_review: { tone: 'gray' },
      withdrawn: { tone: 'gray' },
      approved: { tone: 'violet' },
    };
    (Object.keys(expected) as ConsentState[]).forEach(state => {
      const chip = consentChip(state);
      expect(chip.tone, state).toBe(expected[state].tone);
      expect(chip.label.length).toBeGreaterThan(0);
    });
  });

  it('login chip: amber until credentials exist', () => {
    expect(loginChip(false).tone).toBe('amber');
    expect(loginChip(true).tone).toBe('violet');
  });

  it('visibility chip: private is neutral, public is violet', () => {
    expect(visibilityChip('private')).toEqual({ label: 'Private', tone: 'gray' });
    expect(visibilityChip('public')).toEqual({ label: 'Public', tone: 'violet' });
    expect(visibilityChip(null).label).toBe('Private');
  });
});

describe('messagingChip', () => {
  it('mirrors the MESSAGING_OPTIONS vocabulary', () => {
    expect(messagingChip('everyone')).toEqual({ label: 'Messages: everyone', tone: 'amber' });
    expect(messagingChip('fans_only')).toEqual({ label: 'Messages: fans', tone: 'violet' });
    expect(messagingChip('mutual_fans')).toEqual({ label: 'Messages: mutual fans', tone: 'violet' });
    expect(messagingChip('nobody')).toEqual({ label: 'Messages: off', tone: 'gray' });
  });

  it('unknown/null reads as the locked-down default, gray not alarming', () => {
    expect(messagingChip(null).tone).toBe('gray');
    expect(messagingChip(undefined).tone).toBe('gray');
    expect(messagingChip('garbage').tone).toBe('gray');
  });
});
