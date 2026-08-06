'use client';

import { useMemo, useState } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import DockComposer from './DockComposer';
import DockGroupComposer, { EMPTY_GROUP_DRAFT, type GroupDraft } from './DockGroupComposer';
import DockConversationRow from './DockConversationRow';
import { conversationIdentity } from './conversation-identity';
import type { Conversation, ParticipantProfile } from '@/types/messages';

/** Which body the expanded panel shows. Mutually exclusive by construction. */
export type DockComposeMode = 'list' | 'direct' | 'group';

// The widget's BODY: search, active contacts, and the conversation list
// (or the composer). The violet bar above it lives in ChatDock, because
// that bar is the pill itself — collapsed it's the launcher, expanded it's
// this body's banner. Keeping them in one component there is what makes the
// morph a single element rather than a panel stacked on a pill.
// Selecting anyone opens a mini window; nothing here navigates away.

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
  mode,
  onModeChange,
  onSelect,
  onOpenWindow,
  fetchConversations,
}: {
  conversations: Conversation[];
  currentUserId: string;
  onlineIds: Set<string>;
  /** Conversations that already have an open or minimized window. */
  windowIds: Set<string>;
  /** Compose mode is owned by the widget bar, which holds the pen button. */
  mode: DockComposeMode;
  onModeChange: (mode: DockComposeMode) => void;
  onSelect: (conversationId: string) => void;
  onOpenWindow: (conversationId: string) => void;
  fetchConversations: () => Promise<void>;
}) {
  const [filter, setFilter] = useState('');
  // The group draft lives HERE, not in DockGroupComposer: this panel is always
  // mounted (ChatDock keeps the body mounted and inert while collapsed), so
  // collapsing the pill, hitting Cancel, or bouncing to the direct composer all
  // preserve what the user typed. That is why the flow needs no discard confirm.
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(EMPTY_GROUP_DRAFT);

  // Open a just-created conversation as a mini window.
  //
  // The refetch MUST be awaited BEFORE dispatching. ChatDock renders a window
  // only for a conversation the provider already knows, and it PRUNEs window
  // ids against that list on every conversations update — so with a fire-and-
  // forget refetch, a realtime INSERT or the 30s poll landing in the gap drops
  // the brand-new id and the window silently never appears. Awaiting is safe:
  // GET /api/messages lists every conversation with no "has messages" filter,
  // so an empty new group is in the list immediately.
  //
  // The guard skips the round trip on the existing-conversation fast path,
  // where nothing was created and the id is already known.
  const openConversation = async (conversationId: string) => {
    if (!conversations.some(c => c.id === conversationId)) {
      await fetchConversations();
    }
    onModeChange('list');
    onOpenWindow(conversationId);
  };

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

  return (
    <div data-testid="dock-panel" className="h-full flex flex-col bg-surface-raised">
      {mode === 'direct' ? (
        <DockComposer
          currentUserId={currentUserId}
          existingDirectWith={directWith}
          onOpened={openConversation}
          onCancel={() => onModeChange('list')}
        />
      ) : mode === 'group' ? (
        <DockGroupComposer
          currentUserId={currentUserId}
          draft={groupDraft}
          onDraftChange={setGroupDraft}
          onOpened={openConversation}
          onCancel={() => onModeChange('list')}
        />
      ) : (
        <>
          {/* Group chat is a first-class starting point, not something buried
              on the full board — so it leads the panel, above search. */}
          <div className="px-3 py-2 border-b border-border-subtle shrink-0">
            <button
              type="button"
              onClick={() => onModeChange('group')}
              className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-brand-soft transition-colors"
            >
              <span className="w-8 h-8 rounded-full bg-violet-100 text-brand-fg-strong flex items-center justify-center shrink-0">
                <i className="fas fa-users text-xs"></i>
              </span>
              <span className="text-sm font-semibold text-primary">New group chat</span>
            </button>
          </div>

          {/* Search — same markup as the full messages page's list search. */}
          <div className="px-3 py-2 border-b border-border-subtle shrink-0">
            <div className="relative">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-faint text-xs"></i>
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Search conversations…"
                aria-label="Search conversations"
                className="w-full pl-8 pr-3 py-2 bg-surface-sunken rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {activeContacts.length > 0 && (
            <div className="px-3 py-2 border-b border-border-subtle shrink-0">
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1.5">
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
                          <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-brand-fg-strong">
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

          <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                {filter ? (
                  <>
                    <i className="fas fa-search text-gray-300 text-2xl mb-2"></i>
                    <p className="text-sm text-muted">
                      No conversations match &ldquo;{filter}&rdquo;
                    </p>
                  </>
                ) : (
                  <>
                    <span className="w-12 h-12 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-3">
                      <i className="fas fa-comment-alt text-faint text-lg"></i>
                    </span>
                    <p className="text-sm font-semibold text-secondary">No conversations yet</p>
                    <p className="text-xs text-muted mb-4">
                      Start a conversation with another athlete.
                    </p>
                    <button
                      type="button"
                      onClick={() => onModeChange('direct')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition-colors"
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
