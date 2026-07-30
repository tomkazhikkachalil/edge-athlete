import { describe, it, expect } from 'vitest';
import { conversationIdentity, isConversationPartnerOnline } from '../conversation-identity';
import type { Conversation, ConversationParticipant, ParticipantProfile } from '@/types/messages';

const ME = 'me-1';

const profile = (over: Partial<ParticipantProfile> = {}): ParticipantProfile =>
  ({
    id: 'them-1',
    first_name: 'Rory',
    last_name: 'Adams',
    full_name: 'Rory Adams',
    avatar_url: 'https://example.com/a.jpg',
    handle: 'rory',
    ...over,
  }) as ParticipantProfile;

const participant = (
  profileId: string,
  prof: ParticipantProfile | null
): ConversationParticipant =>
  ({ profile_id: profileId, profile: prof } as unknown as ConversationParticipant);

const conversation = (over: Partial<Conversation> = {}): Conversation =>
  ({
    id: 'c1',
    type: 'direct',
    name: null,
    avatar_url: null,
    updated_at: '2026-07-30T00:00:00.000Z',
    participants: [participant(ME, profile({ id: ME })), participant('them-1', profile())],
    last_message: null,
    unread_count: 0,
    ...over,
  }) as Conversation;

describe('conversationIdentity', () => {
  it('names a direct conversation after the other participant', () => {
    const id = conversationIdentity(conversation(), ME);
    expect(id.title).toBe('Rory Adams');
    expect(id.avatarUrl).toBe('https://example.com/a.jpg');
    expect(id.initials).toBe('RA');
    expect(id.isGroup).toBe(false);
    expect(id.other?.id).toBe('them-1');
  });

  it('never selects the current user, even when a participant profile failed to load', () => {
    // The nested `profile?.id` form would match self here and label the
    // conversation with the viewer's own name.
    const c = conversation({
      participants: [participant(ME, null), participant('them-1', profile())],
    });
    expect(conversationIdentity(c, ME).title).toBe('Rory Adams');
  });

  it('falls back to "Conversation" when the other profile is missing', () => {
    const c = conversation({ participants: [participant(ME, profile({ id: ME })), participant('them-1', null)] });
    const id = conversationIdentity(c, ME);
    expect(id.title).toBe('Conversation');
    expect(id.avatarUrl).toBeNull();
    expect(id.other).toBeNull();
  });

  it('uses the group name and avatar for groups', () => {
    const id = conversationIdentity(
      conversation({ type: 'group', name: 'Range Crew', avatar_url: 'https://example.com/g.jpg' }),
      ME
    );
    expect(id.title).toBe('Range Crew');
    expect(id.avatarUrl).toBe('https://example.com/g.jpg');
    expect(id.isGroup).toBe(true);
    expect(id.other).toBeNull();
  });

  it('falls back to "Group" for an unnamed group', () => {
    expect(conversationIdentity(conversation({ type: 'group', name: null }), ME).title).toBe('Group');
  });

  it('tolerates a missing participants array', () => {
    const c = { ...conversation(), participants: undefined } as unknown as Conversation;
    expect(conversationIdentity(c, ME).title).toBe('Conversation');
  });
});

describe('isConversationPartnerOnline', () => {
  it('is true only when the direct partner is in the online set', () => {
    const id = conversationIdentity(conversation(), ME);
    expect(isConversationPartnerOnline(id, new Set(['them-1']))).toBe(true);
    expect(isConversationPartnerOnline(id, new Set(['someone-else']))).toBe(false);
    expect(isConversationPartnerOnline(id, new Set())).toBe(false);
  });

  it('is never true for a group, even if members are online', () => {
    const id = conversationIdentity(conversation({ type: 'group', name: 'Range Crew' }), ME);
    expect(isConversationPartnerOnline(id, new Set(['them-1']))).toBe(false);
  });
});
