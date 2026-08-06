'use client';

import LazyImage from '@/components/LazyImage';
import { conversationIdentity, isConversationPartnerOnline } from './conversation-identity';
import type { Conversation } from '@/types/messages';

// Minimized chats as labeled pills in a horizontal row BESIDE the dock pill
// (Tom's layout — they follow along the bottom edge, not stacked above).
// Each pill: avatar circle + visible name, presence dot on the avatar,
// inline unread badge, hover/focus close X. Click restores the window;
// only the X removes it. Unread badges come straight from the provider's
// per-conversation counts; titles come from the dock's shared identity
// helper so a pill, its row in the panel, and the window it restores all
// read identically.

// White surface chip — violet stays reserved for the Messages pill. To go
// violet instead, swap to:
//   pill:  'flex items-center gap-2 h-11 pl-1.5 pr-3 rounded-lg max-w-44
//           bg-brand text-white hover:bg-brand-hover shadow-2xl
//           transition-colors'
//   name:  'text-sm font-medium truncate'
//   badge: swap bg-red-500 text-white → bg-surface text-brand-fg-strong, and the
//          presence dot border-white → border-brand.
const PILL_CLASSES =
  'ea-surface ea-surface-raised ea-interactive flex items-center gap-2 h-11 pl-1.5 pr-3 rounded-lg max-w-44';
const NAME_CLASSES = 'text-sm font-medium text-primary truncate';
const BADGE_CLASSES =
  'ml-auto shrink-0 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-4.5 h-4.5 px-1 flex items-center justify-center';

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
    <div className="flex items-end gap-2 pointer-events-auto">
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
              aria-label={`Restore chat with ${name}`}
              onClick={() => onRestore(id)}
              className={PILL_CLASSES}
            >
              <span className="relative shrink-0">
                <span className="block w-8 h-8 rounded-full overflow-hidden bg-violet-100">
                  {avatarUrl ? (
                    <LazyImage src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-brand-fg-strong">
                      {initials}
                    </span>
                  )}
                </span>
                {online && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full pointer-events-none"></span>
                )}
              </span>
              <span className={NAME_CLASSES}>{name}</span>
              {unread > 0 && <span className={BADGE_CLASSES}>{unread > 9 ? '9+' : unread}</span>}
            </button>
            <button
              type="button"
              aria-label={`Close chat with ${name}`}
              onClick={() => onClose(id)}
              className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-gray-700 text-white rounded-full items-center justify-center hidden group-hover:flex group-focus-within:flex text-[9px] hover:bg-gray-900"
            >
              <i className="fas fa-xmark"></i>
            </button>
          </div>
        );
      })}
    </div>
  );
}
