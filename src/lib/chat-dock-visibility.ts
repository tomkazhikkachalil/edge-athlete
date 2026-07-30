// Whether the corner messaging widget is switched off. Persisted, because
// closing it is a real preference — it has to survive navigation and
// refreshes, not just the current page view.
//
// This lives in lib/ rather than components/chat-dock/ on purpose: the
// Messages page renders the toggle that restores the widget, and importing
// it from the dock folder would mean deleting that folder breaks the
// Messages page. Here, deleting the dock leaves the toggle inert instead.
//
// Own key rather than a field in ea:chat-dock:v1 — that payload carries the
// open/minimized window layout, and reshaping it would risk wiping existing
// users' layout on parse. Same '1'-or-absent shape as the app's other
// dismissal flags (ea:live-banner-dismissed:*, ea:workout-banner-dismissed:*).

export const CHAT_DOCK_HIDDEN_KEY = 'ea:chat-dock-hidden:v1';

/** Same-tab notification: the native `storage` event does NOT fire in the
 *  tab that made the write, and the dock lives in the root layout so it
 *  never remounts to re-read. */
export const CHAT_DOCK_VISIBILITY_EVENT = 'ea:chat-dock-visibility';

export function isChatDockHidden(): boolean {
  try {
    return window.localStorage.getItem(CHAT_DOCK_HIDDEN_KEY) === '1';
  } catch {
    // private mode / storage disabled — treat the widget as visible
    return false;
  }
}

export function setChatDockHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(CHAT_DOCK_HIDDEN_KEY, '1');
    else window.localStorage.removeItem(CHAT_DOCK_HIDDEN_KEY);
  } catch {
    // private mode / quota — the event below still updates this session
  }
  try {
    window.dispatchEvent(
      new CustomEvent<boolean>(CHAT_DOCK_VISIBILITY_EVENT, { detail: hidden })
    );
  } catch {
    // no CustomEvent (non-browser) — nothing to notify
  }
}

/** Subscribe to changes from this tab (CustomEvent) and other tabs
 *  (storage). Returns a cleanup for useEffect. */
export function subscribeChatDockVisibility(
  onChange: (hidden: boolean) => void
): () => void {
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<boolean>).detail;
    onChange(typeof detail === 'boolean' ? detail : isChatDockHidden());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== CHAT_DOCK_HIDDEN_KEY) return;
    onChange(isChatDockHidden());
  };

  window.addEventListener(CHAT_DOCK_VISIBILITY_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHAT_DOCK_VISIBILITY_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}
