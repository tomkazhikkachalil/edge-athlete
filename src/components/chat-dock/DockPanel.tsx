'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import LazyImage from '@/components/LazyImage';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import DockComposer from './DockComposer';
import DockConversationRow from './DockConversationRow';
import { conversationIdentity } from './conversation-identity';
import type { Conversation, ParticipantProfile } from '@/types/messages';

// The expanded dock panel — one continuous surface with the pill it grew
// out of: same violet chrome on top, same width, same rounded-top shell.
// Top to bottom: banner (you + controls), search, active contacts, your
// conversations. Selecting anyone opens a mini window; nothing here
// navigates away except the settings gear.

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
  windowIds,
  unreadCount,
  onSelect,
  onOpenWindow,
  onMinimize,
  onDismiss,
  fetchConversations,
}: {
  conversations: Conversation[];
  currentUserId: string;
  onlineIds: Set<string>;
  /** Conversations that already have an open or minimized window. */
  windowIds: Set<string>;
  unreadCount: number;
  onSelect: (conversationId: string) => void;
  onOpenWindow: (conversationId: string) => void;
  onMinimize: () => void;
  onDismiss: () => void;
  fetchConversations: () => Promise<void>;
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const [filter, setFilter] = useState('');
  const [composing, setComposing] = useState(false);

  const myName = formatDisplayName(
    profile?.first_name,
    null,
    profile?.last_name,
    profile?.full_name
  );

  // A direct conversation with this partner, if one already exists.
  const directWith = (profileId: string): string | null =>
    conversations.find(
      c => c.type === 'direct' && (c.participants ?? []).some(p => p.profile?.id === profileId)
    )?.id ?? null;

  // Online partners we can actually open a thread with. Partners known
  // only from a group chat have no direct thread, and their avatar used to
  // be a silent no-op — leave them out rather than render a dead button.
  const activeContacts = useMemo(
    () =>
      conversationPartners(conversations, currentUserId)
        .filter(p => onlineIds.has(p.id) && directWith(p.id))
        .slice(0, ACTIVE_ROW_CAP),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, currentUserId, onlineIds]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(conversation => {
      if (conversationIdentity(conversation, currentUserId).title.toLowerCase().includes(q)) {
        return true;
      }
      return (conversation.participants ?? []).some(p => {
        const p2 = p.profile;
        if (!p2 || p2.id === currentUserId) return false;
        return (p2.handle ?? '').toLowerCase().includes(q);
      });
    });
  }, [conversations, filter, currentUserId]);

  const iconBtn = 'w-6 h-6 rounded flex items-center justify-center transition-colors';

  return (
    <div
      data-testid="dock-panel"
      className="w-80 bg-white rounded-t-lg shadow-2xl border border-gray-200 border-b-0 overflow-hidden flex flex-col ea-dock-rise"
      /* Leave room for the pill below so the panel's top never leaves the
         viewport — it grows upward from the bottom-anchored column. */
      style={{ maxHeight: 'min(28rem, calc(100vh - 5rem))' }}
    >
      {/* Banner — the same violet as the pill, so the panel reads as the
          pill expanded rather than a separate dropdown. */}
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-t-lg shrink-0">
        <span className="block w-7 h-7 rounded-full overflow-hidden bg-violet-400 shrink-0">
          {profile?.avatar_url ? (
            <LazyImage
              src={profile.avatar_url}
              alt={myName}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[10px] font-semibold text-white">
              {getInitials(myName)}
            </span>
          )}
        </span>

        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate">Messages</span>
          {unreadCount > 0 && (
            <span className="shrink-0 bg-white text-violet-700 text-[10px] font-bold rounded-full min-w-4.5 h-4.5 px-1 flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={() => setComposing(c => !c)}
          aria-label="New message"
          title="New message"
          aria-pressed={composing}
          className={`${iconBtn} ${composing ? 'bg-white text-violet-700' : 'hover:bg-violet-500'}`}
        >
          <i className="fas fa-pen text-[10px]"></i>
        </button>
        <button
          type="button"
          onClick={() => router.push('/settings?tab=messaging')}
          aria-label="Messaging settings"
          title="Messaging settings"
          className={`${iconBtn} hover:bg-violet-500`}
        >
          <i className="fas fa-cog text-[10px]"></i>
        </button>
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimize messages"
          title="Minimize"
          className={`${iconBtn} hover:bg-violet-500`}
        >
          <i className="fas fa-chevron-down text-[10px]"></i>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close messages"
          title="Close"
          className={`${iconBtn} hover:bg-violet-500`}
        >
          <i className="fas fa-xmark text-xs"></i>
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
          {/* Search — same markup as the full messages page's list search. */}
          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="relative">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Search conversations…"
                aria-label="Search conversations"
                className="w-full pl-8 pr-3 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {activeContacts.length > 0 && (
            <div className="px-3 py-2 border-b border-gray-100 shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Active now
              </p>
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {activeContacts.map(contact => {
                  const name = formatDisplayName(
                    contact.first_name,
                    null,
                    contact.last_name,
                    contact.full_name
                  );
                  const existing = directWith(contact.id);
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      title={name}
                      aria-label={`Message ${name}`}
                      onClick={() => existing && onSelect(existing)}
                      className="relative shrink-0 rounded-full hover:ring-2 hover:ring-violet-300 transition"
                    >
                      <span className="block w-9 h-9 rounded-full overflow-hidden bg-violet-100">
                        {contact.avatar_url ? (
                          <LazyImage
                            src={contact.avatar_url}
                            alt={name}
                            className="w-full h-full object-cover"
                          />
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

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                {filter ? (
                  <>
                    <i className="fas fa-search text-gray-300 text-2xl mb-2"></i>
                    <p className="text-sm text-gray-500">
                      No conversations match &ldquo;{filter}&rdquo;
                    </p>
                  </>
                ) : (
                  <>
                    <span className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <i className="fas fa-comment-alt text-gray-400 text-lg"></i>
                    </span>
                    <p className="text-sm font-semibold text-gray-700">No conversations yet</p>
                    <p className="text-xs text-gray-500 mb-4">
                      Start a conversation with another athlete.
                    </p>
                    <button
                      type="button"
                      onClick={() => setComposing(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
                    >
                      <i className="fas fa-pen text-xs"></i>
                      New message
                    </button>
                  </>
                )}
              </div>
            ) : (
              filtered.map(conversation => (
                <DockConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  currentUserId={currentUserId}
                  onlineIds={onlineIds}
                  hasWindow={windowIds.has(conversation.id)}
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
