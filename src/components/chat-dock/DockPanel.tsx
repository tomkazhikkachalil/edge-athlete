'use client';

import { useMemo, useState } from 'react';
import LazyImage from '@/components/LazyImage';
import ConversationItem from '@/components/messages/ConversationItem';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import DockComposer from './DockComposer';
import type { Conversation, ParticipantProfile } from '@/types/messages';

// The expanded dock panel: active contacts, filterable recent
// conversations (ConversationItem reused verbatim from the full page —
// one system, two doors), and the composer. Selecting anything opens a
// mini window; nothing here navigates away.

const ACTIVE_ROW_CAP = 8;

function conversationPartners(
  conversations: Conversation[],
  currentUserId: string
): ParticipantProfile[] {
  const seen = new Map<string, ParticipantProfile>();
  for (const conversation of conversations) {
    for (const participant of conversation.participants ?? []) {
      const profile = participant.profile;
      if (!profile?.id || profile.id === currentUserId || seen.has(profile.id)) continue;
      seen.set(profile.id, profile);
    }
  }
  return [...seen.values()];
}

export default function DockPanel({
  conversations,
  currentUserId,
  onlineIds,
  onSelect,
  onOpenWindow,
  fetchConversations,
}: {
  conversations: Conversation[];
  currentUserId: string;
  onlineIds: Set<string>;
  onSelect: (conversationId: string) => void;
  onOpenWindow: (conversationId: string) => void;
  fetchConversations: () => Promise<void>;
}) {
  const [filter, setFilter] = useState('');
  const [composing, setComposing] = useState(false);

  const activeContacts = useMemo(
    () =>
      conversationPartners(conversations, currentUserId)
        .filter(p => onlineIds.has(p.id))
        .slice(0, ACTIVE_ROW_CAP),
    [conversations, currentUserId, onlineIds]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(conversation => {
      if (conversation.name?.toLowerCase().includes(q)) return true;
      return (conversation.participants ?? []).some(p => {
        const profile = p.profile;
        if (!profile || profile.id === currentUserId) return false;
        const name = formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name);
        return name.toLowerCase().includes(q) || (profile.handle ?? '').toLowerCase().includes(q);
      });
    });
  }, [conversations, filter, currentUserId]);

  // A direct conversation with this partner, if one already exists.
  const directWith = (profileId: string): string | null =>
    conversations.find(
      c => c.type === 'direct' && (c.participants ?? []).some(p => p.profile?.id === profileId)
    )?.id ?? null;

  return (
    <div
      data-testid="dock-panel"
      className="w-80 bg-white rounded-t-lg shadow-2xl border border-gray-200 border-b-0 overflow-hidden flex flex-col"
      /* Leave room for the pill below so the panel's top never leaves the
         viewport — it grows upward from the bottom-anchored column. */
      style={{ maxHeight: 'min(28rem, calc(100vh - 5rem))' }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 text-sm">Messages</h3>
        <button
          type="button"
          onClick={() => setComposing(c => !c)}
          aria-label="New message"
          title="New message"
          className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
            composing ? 'bg-violet-600 text-white' : 'text-violet-600 hover:bg-violet-50'
          }`}
        >
          <i className="fas fa-pen text-xs"></i>
        </button>
      </div>

      {composing ? (
        <DockComposer
          currentUserId={currentUserId}
          existingDirectWith={directWith}
          onOpened={conversationId => {
            setComposing(false);
            onOpenWindow(conversationId);
            fetchConversations();
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <>
          {activeContacts.length > 0 && (
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Active now
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {activeContacts.map(profile => {
                  const name = formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name);
                  const existing = directWith(profile.id);
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      title={name}
                      onClick={() => existing && onSelect(existing)}
                      className="relative shrink-0"
                    >
                      <span className="block w-9 h-9 rounded-full overflow-hidden bg-violet-100">
                        {profile.avatar_url ? (
                          <LazyImage src={profile.avatar_url} alt={name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-violet-700">
                            {getInitials(name)}
                          </span>
                        )}
                      </span>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-3 py-2 border-b border-gray-100">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search conversations…"
              className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                {filter ? 'No matching conversations.' : 'No conversations yet — say hi!'}
              </p>
            ) : (
              filtered.map(conversation => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  currentUserId={currentUserId}
                  isActive={false}
                  onClick={() => onSelect(conversation.id)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
