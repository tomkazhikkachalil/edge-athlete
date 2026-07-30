'use client';

import LazyImage from '@/components/LazyImage';
import { conversationIdentity, isConversationPartnerOnline } from './conversation-identity';
import type { Conversation } from '@/types/messages';

// Minimized chats as avatar bubbles above the dock pill (the FB pattern).
// Unread badges come straight from the provider's per-conversation counts.
// Titles come from the dock's shared identity helper so a bubble, its row
// in the panel, and the window it restores all read identically.

export default function MinimizedStack({
  ids,
  conversationById,
  currentUserId,
  onlineIds,
  onRestore,
  onClose,
}: {
  ids: string[];
  conversationById: Map<string, Conversation>;
  currentUserId: string;
  onlineIds: Set<string>;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (ids.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-2 mb-1">
      {ids.map(id => {
        const conversation = conversationById.get(id);
        if (!conversation) return null;
        const identity = conversationIdentity(conversation, currentUserId);
        const { title: name, avatarUrl, initials } = identity;
        const online = isConversationPartnerOnline(identity, onlineIds);
        const unread = conversation.unread_count ?? 0;
        return (
          <div key={id} className="relative group">
            <button
              type="button"
              title={name}
              onClick={() => onRestore(id)}
              className="block w-11 h-11 rounded-full overflow-hidden bg-violet-100 shadow-lg ring-2 ring-white hover:ring-violet-300 transition"
            >
              {avatarUrl ? (
                <LazyImage src={avatarUrl} alt={name} className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-sm font-semibold text-violet-700">
                  {initials}
                </span>
              )}
            </button>
            {online && (
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full pointer-events-none"></span>
            )}
            {unread > 0 && (
              <span className="absolute -top-1 -left-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-4.5 h-4.5 px-1 flex items-center justify-center pointer-events-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            <button
              type="button"
              aria-label={`Close chat with ${name}`}
              onClick={() => onClose(id)}
              className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-gray-700 text-white rounded-full items-center justify-center hidden group-hover:flex text-[9px] hover:bg-gray-900"
            >
              <i className="fas fa-xmark"></i>
            </button>
          </div>
        );
      })}
    </div>
  );
}
