'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import { FEATURE_FLAGS } from '@/lib/features';
import {
  dockReducer,
  initialDockState,
  loadDockState,
  saveDockState,
  windowCapForWidth,
} from './dock-state';
import { usePresence } from './usePresence';
import DockPanel from './DockPanel';
import MiniChatWindow from './MiniChatWindow';
import MinimizedStack from './MinimizedStack';

// ── The persistent chat dock ─────────────────────────────────────────────────
// Rendered ONCE in the root layout (inside MessagesProvider), so App Router
// soft navigation never unmounts it: open windows, scroll positions, and
// half-typed drafts ride across pages untouched — that persistence is the
// entire product. It is a pure second VIEW over the existing messaging
// system (MessagesProvider is its whole list/badge data source; mini
// windows use the same endpoints as the full page). Deleting
// src/components/chat-dock/ leaves messaging exactly as it was.
//
// Gates (all JS-level — CSS hiding alone would still run presence and
// read-marking on phones): feature flag, signed-in user, viewport >= lg,
// and NOT on /messages (the dedicated page IS the full experience — the
// FB/LinkedIn convention, and it avoids double realtime + racing
// read-marking on the same conversation).

export default function ChatDock() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { conversations, totalUnreadCount, loading, fetchConversations } = useMessages();
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  const [hydrated, setHydrated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const enabled = FEATURE_FLAGS.FEATURE_CHAT_DOCK && !!user && isDesktop;
  const visible = enabled && !pathname?.startsWith('/messages');

  // Viewport gate + width-aware window cap (SSR-safe: starts false).
  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_CHAT_DOCK) return;
    const media = window.matchMedia('(min-width: 1024px)');
    const apply = () => {
      setIsDesktop(media.matches);
      dispatch({ type: 'SET_CAP', cap: windowCapForWidth(window.innerWidth) });
    };
    apply();
    media.addEventListener('change', apply);
    window.addEventListener('resize', apply);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);

  // Hydrate persisted layout once, then persist on every change.
  useEffect(() => {
    if (!enabled || hydrated) return;
    const persisted = loadDockState();
    if (persisted) dispatch({ type: 'HYDRATE', state: persisted });
    setHydrated(true);
  }, [enabled, hydrated]);

  useEffect(() => {
    if (hydrated) saveDockState(state);
  }, [state, hydrated]);

  // Drop persisted conversation ids that no longer exist for this user.
  useEffect(() => {
    if (!hydrated || loading || conversations.length === 0) return;
    dispatch({ type: 'PRUNE', validIds: conversations.map(c => c.id) });
  }, [hydrated, loading, conversations]);

  // Presence: mounted only when the dock is enabled (never on phones).
  const onlineIds = usePresence(enabled ? user!.id : null);

  // Browser-tab unread badge. Known limit: soft-nav title rewrites clear
  // the prefix until the next unread change — acceptable v1.
  useEffect(() => {
    if (!enabled) return;
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = totalUnreadCount > 0 ? `(${totalUnreadCount}) ${base}` : base;
  }, [totalUnreadCount, enabled]);

  const openWindow = useCallback((conversationId: string) => {
    dispatch({ type: 'OPEN_WINDOW', id: conversationId });
  }, []);

  const openFullView = useCallback((conversationId: string) => {
    router.push(`/messages?c=${conversationId}`);
  }, [router]);

  if (!visible) return null;

  const conversationById = new Map(conversations.map(c => [c.id, c]));

  return (
    <div className="hidden lg:block">
      {/* Mini windows row: fixed, right of the dock pill/panel. */}
      <div className="fixed bottom-0 right-[22rem] z-[45] flex items-end gap-3 pointer-events-none">
        {state.open.map(id => {
          const conversation = conversationById.get(id);
          if (!conversation) return null;
          return (
            <div key={id} className="pointer-events-auto">
              <MiniChatWindow
                conversation={conversation}
                currentUserId={user!.id}
                minimized={false}
                onlineIds={onlineIds}
                onMinimize={() => dispatch({ type: 'MINIMIZE', id })}
                onClose={() => dispatch({ type: 'CLOSE_WINDOW', id })}
                onOpenFull={() => openFullView(id)}
              />
            </div>
          );
        })}
        {/* Minimized windows stay mounted (hidden) so their thread state,
            scroll, and reply context restore instantly. */}
        {state.minimized.map(id => {
          const conversation = conversationById.get(id);
          if (!conversation) return null;
          return (
            <div key={id} className="hidden">
              <MiniChatWindow
                conversation={conversation}
                currentUserId={user!.id}
                minimized
                onlineIds={onlineIds}
                onMinimize={() => {}}
                onClose={() => dispatch({ type: 'CLOSE_WINDOW', id })}
                onOpenFull={() => openFullView(id)}
              />
            </div>
          );
        })}
      </div>

      {/* Dock corner: minimized bubbles above the panel/pill. */}
      <div className="fixed bottom-0 right-4 z-[45] flex flex-col items-end gap-2 pb-0">
        <MinimizedStack
          ids={state.minimized}
          conversationById={conversationById}
          currentUserId={user!.id}
          onlineIds={onlineIds}
          onRestore={id => dispatch({ type: 'RESTORE', id })}
          onClose={id => dispatch({ type: 'CLOSE_WINDOW', id })}
        />

        {state.panelOpen && (
          <DockPanel
            conversations={conversations}
            currentUserId={user!.id}
            onlineIds={onlineIds}
            onSelect={id => {
              openWindow(id);
              dispatch({ type: 'CLOSE_PANEL' });
            }}
            onOpenWindow={openWindow}
            fetchConversations={fetchConversations}
          />
        )}

        {/* The collapsed pill. */}
        <button
          type="button"
          onClick={() => dispatch({ type: 'TOGGLE_PANEL' })}
          className="flex items-center gap-2 bg-violet-600 text-white pl-4 pr-3 py-2.5 rounded-t-lg shadow-lg hover:bg-violet-700 transition text-sm font-medium"
          aria-expanded={state.panelOpen}
          aria-label="Messages dock"
        >
          <i className="fas fa-comment-alt"></i>
          Messages
          {totalUnreadCount > 0 && (
            <span className="bg-white text-violet-700 text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </span>
          )}
          <i className={`fas fa-chevron-${state.panelOpen ? 'down' : 'up'} text-xs opacity-70`}></i>
        </button>
      </div>
    </div>
  );
}
