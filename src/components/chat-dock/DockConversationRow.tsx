'use client';

import LazyImage from '@/components/LazyImage';
import { getRelativeTime, getLastMessagePreview } from '@/components/messages/ConversationItem';
import { conversationIdentity, isConversationPartnerOnline } from './conversation-identity';
import type { Conversation } from '@/types/messages';

// A conversation row sized for the dock's 320px chrome. The full page's
// ConversationItem is deliberately left alone — its 48px avatar and
// px-4 py-3 belong to a full-width sidebar — but the timestamp and
// preview formatting are imported from it so the two surfaces can never
// word the same message differently.

export default function DockConversationRow({
  conversation,
  currentUserId,
  onlineIds,
  hasWindow,
  onClick,
}: {
  conversation: Conversation;
  currentUserId: string;
  onlineIds: Set<string>;
  /** True when this conversation already has an open or minimized window. */
  hasWindow: boolean;
  onClick: () => void;
}) {
  const identity = conversationIdentity(conversation, currentUserId);
  const online = isConversationPartnerOnline(identity, onlineIds);
  const unread = conversation.unread_count ?? 0;
  const preview = getLastMessagePreview(conversation, currentUserId);
  const timestamp = conversation.last_message?.created_at || conversation.updated_at;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-2 transition-colors ${
        hasWindow
          ? 'bg-brand-soft border-l-2 border-brand'
          : 'hover:bg-brand-soft border-l-2 border-transparent'
      }`}
    >
      <span className="relative shrink-0">
        <span className="block w-9 h-9 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60">
          {identity.avatarUrl ? (
            <LazyImage
              src={identity.avatarUrl}
              alt={identity.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-brand-fg-strong">
              {identity.initials}
            </span>
          )}
        </span>
        {identity.isGroup && (
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-gray-200 dark:bg-stone-800 rounded-full flex items-center justify-center">
            <i className="fas fa-users text-tertiary" style={{ fontSize: '7px' }}></i>
          </span>
        )}
        {online && (
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-surface-raised rounded-full"></span>
        )}
      </span>

      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span
            className={`flex-1 text-sm truncate ${
              unread > 0 ? 'font-semibold text-primary' : 'font-medium text-secondary'
            }`}
          >
            {identity.title}
          </span>
          {conversation.my_participant?.is_muted && (
            <i className="fas fa-bell-slash text-faint" style={{ fontSize: '10px' }}></i>
          )}
          <span className="text-xs text-faint shrink-0">{getRelativeTime(timestamp)}</span>
        </span>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span
            className={`flex-1 text-xs truncate ${
              unread > 0 ? 'text-primary font-medium' : 'text-muted'
            }`}
          >
            {preview}
          </span>
          {unread > 0 && (
            <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-4.5 text-[10px] font-bold text-white bg-red-600 rounded-full px-1">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
