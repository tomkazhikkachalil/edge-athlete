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

// Soft, translucent violet chip (Tom, Sep 8 2026: the white `ea-surface`
// chip "is the same colour as the background" — opaque surface on a surface
// canvas, a hair off the page in dark — so a minimized chat was invisible;
// "a lighter purple, still transparent"). The tint says "this is chat
// chrome" while the saturated brand-chrome Messages pill keeps the top of
// the hierarchy. NOT ea-surface: that class paints an opaque
// var(--color-surface). ea-interactive is kept for the press scale and the
// transitions, and the explicit hover:bg-* is what beats its neutral
// --ea-tint hover. Explicit violet-*/NN rather than bg-brand-soft/NN: under
// an org theme --brand-soft is a color-mix(), which takes no alpha modifier.
const PILL_CLASSES =
  'ea-interactive flex items-center gap-2 h-11 pl-1.5 pr-3 rounded-lg max-w-44 ' +
  'bg-violet-100/85 hover:bg-violet-200/90 border border-violet-200/80 ' +
  'dark:bg-violet-500/25 dark:hover:bg-violet-500/35 dark:border-violet-400/40 ' +
  'backdrop-blur-sm shadow-md';
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
                {/* bg-surface, not violet-100: on the violet-100 pill the old
                    well disappeared into the chip. */}
                <span className="block w-8 h-8 rounded-full overflow-hidden bg-surface dark:bg-violet-950/60">
                  {avatarUrl ? (
                    <LazyImage src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-brand-fg-strong">
                      {initials}
                    </span>
                  )}
                </span>
                {online && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-surface-raised rounded-full pointer-events-none"></span>
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
