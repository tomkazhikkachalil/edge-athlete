'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import { FEATURE_FLAGS } from '@/lib/features';
import {
  dockReducer,
  initialDockState,
  isDockSuppressedPath,
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
// read-marking on phones): feature flag, signed-in user, viewport big
// enough in BOTH axes, and a route where a floating panel is appropriate
// (see isDockSuppressedPath — /messages is the full experience, and
// focused workflows must not have their submit buttons covered).
//
// The height half of the viewport gate matters: the dock is anchored to
// the bottom and grows UPWARD, so on a short viewport (iPad landscape, a
// short laptop window, bottom-docked devtools) an expanded panel would
// run off the top of the screen. Below the threshold it hides entirely
// rather than rendering clipped; above it, the max-heights below keep
// every part on-screen.

export default function ChatDock() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { conversations, totalUnreadCount, loading, fetchConversations } = useMessages();
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  const [hydrated, setHydrated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  // Panel exit needs the element to outlive panelOpen for one animation
  // (the Toast idiom). Dismissal is deliberately NOT persisted: closing
  // clears the corner for this page view, and the dock is back on the next
  // load. Messaging also stays reachable from the header nav, so hiding
  // the dock is never a dead end.
  const [panelExiting, setPanelExiting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const enabled = FEATURE_FLAGS.FEATURE_CHAT_DOCK && !!user && isDesktop;
  const visible = enabled && !dismissed && !isDockSuppressedPath(pathname);

  // Viewport gate + width-aware window cap (SSR-safe: starts false).
  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_CHAT_DOCK) return;
    const media = window.matchMedia('(min-width: 1024px) and (min-height: 600px)');
    const apply = () => {
      setIsDesktop(media.matches);
      // clientWidth, not innerWidth: innerWidth includes the classic
      // scrollbar, which the fixed-positioning viewport excludes — at a cap
      // boundary that over-count fits one window too many and they overlap.
      dispatch({ type: 'SET_CAP', cap: windowCapForWidth(document.documentElement.clientWidth) });
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

  /** Collapse the panel back into the pill, playing the sink animation. */
  const closePanel = useCallback(() => {
    setPanelExiting(true);
    setTimeout(() => {
      dispatch({ type: 'CLOSE_PANEL' });
      setPanelExiting(false);
    }, 160); // matches .ea-dock-sink
  }, []);

  const togglePanel = useCallback(() => {
    if (state.panelOpen) closePanel();
    else dispatch({ type: 'TOGGLE_PANEL' });
  }, [state.panelOpen, closePanel]);

  /** Close (X): sink the panel, then hide the dock for this page view. */
  const dismissDock = useCallback(() => {
    setPanelExiting(true);
    setTimeout(() => {
      dispatch({ type: 'CLOSE_PANEL' });
      setPanelExiting(false);
      setDismissed(true);
    }, 160);
  }, []);

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
            <div key={id} className="pointer-events-auto shrink-0">
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

      {/* Dock corner: minimized bubbles above the panel/pill. Capped to the
          viewport height so the column can never grow off the top edge.
          z-[45] is deliberate: above the sticky header (z-40), below the
          dropdown/modal bands (50+) so modals correctly cover the dock. */}
      <div className="fixed bottom-0 right-4 z-[45] flex flex-col items-end gap-2 pb-0 max-h-[calc(100vh-0.5rem)]">
        <MinimizedStack
          ids={state.minimized}
          conversationById={conversationById}
          currentUserId={user!.id}
          onlineIds={onlineIds}
          onRestore={id => dispatch({ type: 'RESTORE', id })}
          onClose={id => dispatch({ type: 'CLOSE_WINDOW', id })}
        />

        {(state.panelOpen || panelExiting) && (
          /* -mb-2 cancels the column gap so the panel sits flush on the
             pill — together they read as one surface, which is the whole
             point of expanding out of the pill rather than floating above it. */
          <div className={`-mb-2 ${panelExiting ? 'ea-dock-sink' : ''}`}>
            <DockPanel
              conversations={conversations}
              currentUserId={user!.id}
              onlineIds={onlineIds}
              windowIds={new Set([...state.open, ...state.minimized])}
              unreadCount={totalUnreadCount}
              onSelect={id => {
                openWindow(id);
                closePanel();
              }}
              onOpenWindow={openWindow}
              onMinimize={closePanel}
              onDismiss={dismissDock}
              fetchConversations={fetchConversations}
            />
          </div>
        )}

        {/* The collapsed pill. */}
        <button
          type="button"
          onClick={togglePanel}
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
          <i
            className={`fas fa-chevron-up text-xs opacity-70 transition-transform ${
              state.panelOpen ? 'rotate-180' : ''
            }`}
          ></i>
        </button>
      </div>
    </div>
  );
}
