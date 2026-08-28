import { describe, it, expect } from 'vitest';
import { decideFirstContact } from '../first-contact';
import { buildHeldContactRows, buildQueueItems, type RosterRow } from '../guardian-queue';

describe('decideFirstContact', () => {
  const base = {
    childIsSender: false,
    senderIsGuardianOfChild: false,
    contactStatus: null as 'approved' | 'denied' | null,
    followEitherDirection: false,
  };

  it('unknown inbound → hold', () => {
    expect(decideFirstContact(base)).toBe('hold');
  });

  it('approved ledger row → allow, no record', () => {
    expect(decideFirstContact({ ...base, contactStatus: 'approved' })).toBe('allow');
  });

  it('denied ledger row → still hold (repeatable quiet removal)', () => {
    expect(decideFirstContact({ ...base, contactStatus: 'denied' })).toBe('hold');
  });

  it('guardian sender bypasses, recorded', () => {
    expect(decideFirstContact({ ...base, senderIsGuardianOfChild: true })).toBe('allow_record_guardian');
  });

  it('accepted follow either direction bypasses, recorded — and supersedes a denial (follows pass the guardian queue)', () => {
    expect(decideFirstContact({ ...base, followEitherDirection: true })).toBe('allow_record_follow');
    expect(
      decideFirstContact({ ...base, contactStatus: 'denied', followEitherDirection: true })
    ).toBe('allow_record_follow');
  });

  it('child-initiated → allowed + recorded (visibility, not lockdown)', () => {
    expect(decideFirstContact({ ...base, childIsSender: true })).toBe('allow_record_child_initiated');
  });

  it("child-initiated to a DENIED contact → allowed but NOT recorded — the child's outbound must never overwrite a guardian's denial", () => {
    expect(decideFirstContact({ ...base, childIsSender: true, contactStatus: 'denied' })).toBe('allow');
  });
});

describe('buildHeldContactRows', () => {
  const requesterProfile = {
    id: 'stranger',
    first_name: 'Sam',
    last_name: 'Stranger',
    full_name: null,
    handle: 'sam',
    avatar_url: null,
  };

  it('joins held rows to direct-conversation counterparts, guarding embed shapes', () => {
    const rows = buildHeldContactRows(
      [
        { conversation_id: 'c1', profile_id: 'child', held_at: '2026-08-28T10:00:00Z', conversations: { type: 'direct' } },
        { conversation_id: 'c2', profile_id: 'child', held_at: '2026-08-28T11:00:00Z', conversations: [{ type: 'direct' }] },
        { conversation_id: 'c3', profile_id: 'child', held_at: '2026-08-28T12:00:00Z', conversations: { type: 'group' } },
        { conversation_id: 'c4', profile_id: 'child', held_at: '2026-08-28T13:00:00Z', conversations: { type: 'direct' } },
      ],
      [
        { conversation_id: 'c1', profile_id: 'stranger', profiles: requesterProfile },
        { conversation_id: 'c2', profile_id: 'stranger', profiles: [requesterProfile] },
        // c4 has no counterpart row → drops
      ]
    );
    expect(rows.map(r => r.conversationId)).toEqual(['c1', 'c2']);
    expect(rows[0].requester).toMatchObject({ id: 'stranger', name: 'Sam Stranger', handle: 'sam' });
  });
});

describe('age_preset_prompt queue derivation', () => {
  const kid = (id: string): RosterRow => ({
    id,
    first_name: 'Maya',
    last_name: 'Test',
    full_name: null,
    handle: `${id}-handle`,
    avatar_url: null,
    supervision_state: 'supervised',
    visibility: 'private',
    messaging_permission: 'nobody',
    comment_moderation: 'held',
  });
  const pendingRow = {
    id: 'tr-1',
    profile_id: 'a',
    state: 'eligible_notified',
    created_at: '2026-08-28T10:00:00Z',
    age_preset_prompt: 'pending' as string | null,
  };
  const differingPolicy = {
    defaults: { visibility: 'private', messaging_permission: 'nobody', comment_moderation: 'held' },
    olderDefaults: { messaging_permission: 'everyone' },
  } as const;

  it('derives only when rider=pending AND the caller has differing older overrides', () => {
    const items = buildQueueItems(
      [kid('a')], [], [], [], [{ profile_id: 'a', action: 'review_approved' }],
      [{ user_id: 'a', profile_id: 'a' }], [pendingRow], [], [],
      structuredClone(differingPolicy)
    );
    const item = items.find(i => i.kind === 'age_preset_prompt');
    expect(item).toMatchObject({
      id: 'tr-1',
      createdAt: '2026-08-28T10:00:00Z',
      changes: [{ field: 'messaging_permission', from: 'nobody', to: 'everyone' }],
    });
  });

  it('a co-guardian WITHOUT differing overrides sees nothing; NULL rider (pre-wave) never prompts', () => {
    const noOverrides = buildQueueItems(
      [kid('a')], [], [], [], [{ profile_id: 'a', action: 'review_approved' }],
      [{ user_id: 'a', profile_id: 'a' }], [pendingRow], [], [],
      { defaults: { visibility: 'private', messaging_permission: 'nobody', comment_moderation: 'held' }, olderDefaults: null }
    );
    expect(noOverrides.find(i => i.kind === 'age_preset_prompt')).toBeUndefined();

    const preWave = buildQueueItems(
      [kid('a')], [], [], [], [{ profile_id: 'a', action: 'review_approved' }],
      [{ user_id: 'a', profile_id: 'a' }],
      [{ ...pendingRow, age_preset_prompt: null }], [], [],
      structuredClone(differingPolicy)
    );
    expect(preWave.find(i => i.kind === 'age_preset_prompt')).toBeUndefined();

    const decided = buildQueueItems(
      [kid('a')], [], [], [], [{ profile_id: 'a', action: 'review_approved' }],
      [{ user_id: 'a', profile_id: 'a' }],
      [{ ...pendingRow, age_preset_prompt: 'kept' }], [], [],
      structuredClone(differingPolicy)
    );
    expect(decided.find(i => i.kind === 'age_preset_prompt')).toBeUndefined();
  });
});

describe('contact_request queue splice', () => {
  const kid = (id: string): RosterRow => ({
    id,
    first_name: 'Maya',
    last_name: 'Test',
    full_name: null,
    handle: `${id}-handle`,
    avatar_url: null,
    supervision_state: 'supervised',
  });

  it('contact requests sort in the inline-actionable band: follows → contacts → invites → gaps', () => {
    const follower = {
      id: 'fan-1', first_name: 'Fan', last_name: null, full_name: null, handle: null, avatar_url: null,
    };
    const items = buildQueueItems(
      [kid('a')],
      [],
      [],
      [{ id: 'f1', following_id: 'a', message: null, created_at: '2026-08-27T10:00:00Z', follower }],
      [], // consent none → gaps
      [],
      [],
      [],
      [
        {
          childProfileId: 'a',
          heldAt: '2026-08-28T10:00:00Z',
          conversationId: 'c1',
          requester: { id: 'stranger', name: 'Sam Stranger', handle: 'sam', avatarUrl: null },
        },
      ]
    );
    expect(items.map(i => i.kind)).toEqual([
      'follow_request',
      'contact_request',
      'consent_gap',
      'credentials_gap',
    ]);
    expect(items[1]).toMatchObject({
      id: 'contact-a-stranger',
      createdAt: '2026-08-28T10:00:00Z',
      conversationId: 'c1',
    });
  });
});
