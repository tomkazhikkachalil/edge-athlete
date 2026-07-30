'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
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
import {
  isChatDockHidden,
  setChatDockHidden,
  subscribeChatDockVisibility,
} from '@/lib/chat-dock-visibility';
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
  const { user, profile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { conversations, totalUnreadCount, loading, fetchConversations } = useMessages();
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  const [hydrated, setHydrated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  // Closing the widget is a persisted preference, not a per-view dismissal:
  // this component lives in the root layout and never unmounts, so state
  // alone would survive navigation but die on refresh — and there'd be no
  // way back. The flag lives in localStorage and the switch that restores
  // it lives in the Messages area (see QuickMessagesToggle).
  const [hidden, setHidden] = useState(false);
  // Compose lives in the bar now, so its state belongs to the widget.
  const [composing, setComposing] = useState(false);

  const enabled = FEATURE_FLAGS.FEATURE_CHAT_DOCK && !!user && isDesktop;
  const open = state.panelOpen;
  const myName = formatDisplayName(
    profile?.first_name,
    null,
    profile?.last_name,
    profile?.full_name
  );
  const visible = enabled && !hidden && !isDockSuppressedPath(pathname);

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

  // Visibility preference: read once, then follow changes from the Messages
  // toggle (same tab, via CustomEvent) or another tab (storage event).
  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_CHAT_DOCK) return;
    setHidden(isChatDockHidden());
    return subscribeChatDockVisibility(setHidden);
  }, []);

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

  // The widget morphs via CSS transitions on its own width/height, so
  // collapsing is a plain state change — no mount/unmount, and none of the
  // timers the old two-element version needed to keep them in sync.
  const collapsePanel = useCallback(() => {
    dispatch({ type: 'CLOSE_PANEL' });
    setComposing(false);
  }, []);

  const togglePanel = useCallback(() => {
    dispatch({ type: 'TOGGLE_PANEL' });
  }, []);

  /** Close (X): put the whole widget away and remember that. Also tears
   *  down open windows — closing means "clear my messaging workspace". */
  const hideWidget = useCallback(() => {
    dispatch({ type: 'CLEAR_WINDOWS' });
    setComposing(false);
    setChatDockHidden(true); // persists + notifies (setHidden via subscribe)
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

        {/* ── The widget ──────────────────────────────────────────────────
            ONE element in two states. The violet bar is always the same
            DOM node: collapsed it IS the pill, expanded it becomes the
            panel's banner with the conversation body beneath. Width and
            body height are transitioned between two explicit values —
            `auto` can't be interpolated, and a content-derived height
            collapses unevenly — so the pill appears to grow into the
            panel rather than a second surface appearing above it. */}
        <div
          data-testid="chat-widget"
          className={`bg-white rounded-t-lg shadow-2xl border border-gray-200 border-b-0 overflow-hidden flex flex-col transition-[width] duration-200 ease-out ${
            open ? 'w-80' : 'w-44'
          }`}
        >
          {/* The bar. Collapsed it's the whole click target; expanded it
              holds its own controls (buttons can't nest, so the element
              type differs by state even though the visuals don't). */}
          {open ? (
            <div className="flex items-center gap-2 px-3 h-11 bg-violet-600 text-white shrink-0">
              <span className="block w-7 h-7 rounded-full overflow-hidden bg-violet-400 shrink-0">
                {profile?.avatar_url ? (
                  <LazyImage src={profile.avatar_url} alt={myName} className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-[10px] font-semibold text-white">
                    {getInitials(myName)}
                  </span>
                )}
              </span>
              <span className="flex-1 min-w-0 flex items-center gap-1.5">
                <span className="text-sm font-semibold truncate">Messages</span>
                {totalUnreadCount > 0 && (
                  <span className="shrink-0 bg-white text-violet-700 text-[10px] font-bold rounded-full min-w-4.5 h-4.5 px-1 flex items-center justify-center">
                    {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setComposing(c => !c)}
                aria-label="New message"
                title="New message"
                aria-pressed={composing}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  composing ? 'bg-white text-violet-700' : 'hover:bg-violet-500'
                }`}
              >
                <i className="fas fa-pen text-[10px]"></i>
              </button>
              <button
                type="button"
                onClick={() => router.push('/settings?tab=messaging')}
                aria-label="Messaging settings"
                title="Messaging settings"
                className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-violet-500"
              >
                <i className="fas fa-cog text-[10px]"></i>
              </button>
              <button
                type="button"
                onClick={collapsePanel}
                aria-label="Minimize messages"
                title="Minimize"
                className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-violet-500"
              >
                <i className="fas fa-chevron-down text-[10px]"></i>
              </button>
              <button
                type="button"
                onClick={hideWidget}
                aria-label="Close messages"
                title="Close"
                className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-violet-500"
              >
                <i className="fas fa-xmark text-xs"></i>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={togglePanel}
              className="flex items-center gap-2 px-3 h-11 bg-violet-600 text-white hover:bg-violet-700 transition-colors text-sm font-medium w-full"
              aria-expanded={false}
              aria-label="Messages dock"
            >
              <i className="fas fa-comment-alt"></i>
              Messages
              {totalUnreadCount > 0 && (
                <span className="bg-white text-violet-700 text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                  {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                </span>
              )}
              <i className="fas fa-chevron-up text-xs opacity-70 ml-auto"></i>
            </button>
          )}

          {/* The body. Always mounted so the morph is a pure transition;
              inert + aria-hidden while collapsed keeps its controls out of
              the tab order and unclickable at zero height. */}
          <div
            className="overflow-hidden transition-[height,opacity] duration-200 ease-out"
            style={{ height: open ? 'min(24rem, calc(100vh - 7rem))' : '0px', opacity: open ? 1 : 0 }}
            inert={!open}
            aria-hidden={!open}
          >
            <DockPanel
              conversations={conversations}
              currentUserId={user!.id}
              onlineIds={onlineIds}
              windowIds={new Set([...state.open, ...state.minimized])}
              composing={composing}
              onComposingChange={setComposing}
              onSelect={id => {
                openWindow(id);
                collapsePanel();
              }}
              onOpenWindow={openWindow}
              fetchConversations={fetchConversations}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
