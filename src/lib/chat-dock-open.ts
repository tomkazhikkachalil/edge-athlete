'use client';

// Open-a-conversation requests for the chat dock, from surfaces OUTSIDE the
// dock (the full Messages page's "minimize to dock" button). Same shape and
// rationale as chat-dock-visibility.ts: this lives in lib/ so the Messages
// page never imports from components/chat-dock/ — deleting the dock folder
// leaves an inert dispatcher, not a broken import.
//
// Unlike visibility this is a transient INTENT, not a preference: no
// localStorage, and deliberately no cross-tab storage listener (another tab
// asking this tab to pop a chat window open would be wrong).
//
// ChatDock is mounted once in the root layout and never unmounts (it renders
// null on suppressed routes like /messages, but its hooks stay live), so its
// subscription exists from first paint — and these events are only ever fired
// from user clicks, so a fire-before-subscribe race is not a real case.

export const CHAT_DOCK_OPEN_EVENT = 'ea:chat-dock-open-conversation';

/** Ask the always-mounted ChatDock to open this conversation as a window. */
export function requestDockConversation(conversationId: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent<string>(CHAT_DOCK_OPEN_EVENT, { detail: conversationId })
    );
  } catch {
    // non-browser (SSR/static analysis) — nothing to notify
  }
}

/** Same-tab subscription; returns a cleanup suitable for useEffect. */
export function subscribeDockConversationRequests(
  onOpen: (conversationId: string) => void
): () => void {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (typeof detail === 'string' && detail) onOpen(detail);
  };
  window.addEventListener(CHAT_DOCK_OPEN_EVENT, handle);
  return () => window.removeEventListener(CHAT_DOCK_OPEN_EVENT, handle);
}
