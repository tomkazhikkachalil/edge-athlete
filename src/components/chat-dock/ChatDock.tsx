'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { useMessages } from '@/lib/messages';
import {
  DOCK_PANEL_BODY_HEIGHT,
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
import { subscribeDockConversationRequests } from '@/lib/chat-dock-open';
import DockPanel, { type DockComposeMode } from './DockPanel';
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
  const [mode, setMode] = useState<DockComposeMode>('list');

  // The dock launched Jul 28; its flag retired in the consolidation round.
  const enabled = !!user && isDesktop;
  const open = state.panelOpen;
  const myName = formatDisplayName(
    profile?.first_name,
    null,
    profile?.last_name,
    profile?.full_name
  );
  // `hidden` (the persisted close) hides ONLY the widget — open and
  // minimized chats stay on screen; closing the pill must not touch them.
  // Suppressed routes and the enabled gate still hide everything.
  const suppressed = isDockSuppressedPath(pathname);
  const hasWindows = state.open.length > 0 || state.minimized.length > 0;

  // Viewport gate + width-aware window cap (SSR-safe: starts false).
  useEffect(() => {
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
  // Effect-owned deliberately: the layout lives in localStorage, and reading
  // or writing it during render would run on the server.
  useEffect(() => {
    if (!enabled || hydrated) return;
    const persisted = loadDockState();
    if (persisted) dispatch({ type: 'HYDRATE', state: persisted });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, [enabled, hydrated]);

  // Visibility preference: read once, then follow changes from the Messages
  // toggle (same tab, via CustomEvent) or another tab (storage event).
  // Effect-owned deliberately: this is an external-store read-then-subscribe.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(isChatDockHidden());
    return subscribeChatDockVisibility(setHidden);
  }, []);

  useEffect(() => {
    if (hydrated) saveDockState(state);
  }, [state, hydrated]);

  // Open-conversation requests from outside the dock (the full Messages
  // page's "minimize to dock"). This effect stays live even while render is
  // null — the component never unmounts, which is exactly why a request
  // fired on the dock-suppressed /messages route lands: the reducer commits
  // and persists before the caller navigates to a visible route.
  useEffect(() => {
    return subscribeDockConversationRequests(id => {
      setChatDockHidden(false); // opening a chat un-hides a closed dock
      dispatch({ type: 'OPEN_WINDOW', id });
      dispatch({ type: 'CLOSE_PANEL' }); // the window, not the panel, is the focus
      fetchConversations(); // hardening: a brand-new id must survive PRUNE
    });
  }, [fetchConversations]);

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
    setMode('list');
  }, []);

  const togglePanel = useCallback(() => {
    dispatch({ type: 'TOGGLE_PANEL' });
  }, []);

  /** Close (X): put the WIDGET away and remember that — open and minimized
   *  chats are deliberately untouched (Tom: "closing the pill must not
   *  affect the chats"). The preference lasts for the login session; a
   *  fresh sign-in clears it (auth.tsx / oauth.ts). */
  const hideWidget = useCallback(() => {
    dispatch({ type: 'CLOSE_PANEL' }); // reappear collapsed, not expanded
    setMode('list');
    setChatDockHidden(true); // persists + notifies (setHidden via subscribe)
  }, []);

  if (!enabled || suppressed) return null;
  if (hidden && !hasWindows) return null;

  const conversationById = new Map(conversations.map(c => [c.id, c]));

  return (
    <div className="hidden lg:block">
      {/* ONE bottom-anchored row: open windows → minimized pills → the
          widget. Minimized chats sit BESIDE the Messages pill (not stacked
          above it), and a single flex row anchored at right-4 means nothing
          can overlap — the old separate right-[22rem] windows row could
          collide with a horizontal pill run. items-end keeps bottoms
          aligned while windows and the panel body grow upward. z-[45] is
          deliberate: above the sticky header (z-40), below the
          dropdown/modal bands (50+) so modals correctly cover the dock. */}
      <div className="fixed bottom-0 right-4 z-[45] flex items-end gap-3 pointer-events-none">
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
            panel rather than a second surface appearing above it.
            Absent while `hidden` (the persisted close) — the windows and
            minimized pills above stay; close is pill-only. */}
        {!hidden && (
        <div
          data-testid="chat-widget"
          className={`pointer-events-auto shrink-0 max-h-[calc(100dvh-0.5rem)] bg-surface-raised rounded-t-lg shadow-2xl border border-border border-b-0 overflow-hidden flex flex-col transition-[width] duration-200 ease-out ${
            open ? 'w-80' : 'w-44'
          }`}
        >
          {/* The bar. Collapsed it's the whole click target; expanded it
              holds its own controls (buttons can't nest, so the element
              type differs by state even though the visuals don't). */}
          {open ? (
            <div className="relative ea-metal-underline flex items-center gap-2 px-3 h-11 bg-brand-chrome text-white shrink-0">
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
                  <span className="shrink-0 bg-surface text-brand-fg-strong text-[10px] font-bold rounded-full min-w-4.5 h-4.5 px-1 flex items-center justify-center">
                    {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setMode(m => (m === 'direct' ? 'list' : 'direct'))}
                aria-label="New message"
                title="New message"
                aria-pressed={mode === 'direct'}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  mode === 'direct' ? 'bg-surface text-brand-fg-strong' : 'hover:bg-violet-500'
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
              className="flex items-center gap-2 px-3 h-11 bg-brand-chrome text-white hover:bg-brand transition-colors text-sm font-medium w-full"
              aria-expanded={false}
              aria-label="Messages dock"
            >
              <i className="fas fa-comment-alt"></i>
              Messages
              {totalUnreadCount > 0 && (
                <span className="bg-surface text-brand-fg-strong text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
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
            style={{ height: open ? DOCK_PANEL_BODY_HEIGHT : '0px', opacity: open ? 1 : 0 }}
            inert={!open}
            aria-hidden={!open}
          >
            <DockPanel
              conversations={conversations}
              currentUserId={user!.id}
              onlineIds={onlineIds}
              windowIds={new Set([...state.open, ...state.minimized])}
              mode={mode}
              onModeChange={setMode}
              // Opening a conversation deliberately LEAVES THE PANEL OPEN.
              // It used to collapse, which meant picking a second person cost
              // a re-open every time. The window appears beside the panel in
              // the same bottom row, so there is no space conflict — the
              // collapse was never a layout workaround.
              onSelect={openWindow}
              onOpenWindow={openWindow}
              fetchConversations={fetchConversations}
            />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
