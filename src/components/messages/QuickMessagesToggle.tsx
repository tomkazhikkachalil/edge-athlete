'use client';

import { useSyncExternalStore } from 'react';
import {
  isChatDockHidden,
  setChatDockHidden,
  subscribeChatDockVisibility,
} from '@/lib/chat-dock-visibility';

// The way back for anyone who closed the corner messaging widget. It lives
// here because this page is the one place you'd look for messaging settings
// after making the pill disappear — and closing it has to be undoable
// somewhere visible, not only by clearing storage.
//
// Hidden below lg: the widget itself only exists at >= 1024px, so a toggle
// on a phone would switch something the user can never see.

export default function QuickMessagesToggle() {
  // useSyncExternalStore is precisely this: read an external store, subscribe
  // to it, and stay hydration-safe via the server snapshot. The previous
  // mount-effect + setState pair also needed a `ready` flag to avoid acting on
  // the pre-read value; the store hook makes the value correct on the first
  // client render, so that flag is gone.
  const hidden = useSyncExternalStore(
    subscribeChatDockVisibility,
    isChatDockHidden,
    () => false
  );

  const enabled = !hidden;

  return (
    <div className="hidden lg:flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-surface-muted">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-primary">Quick messages</p>
        <p className="text-xs text-muted">Chat pill in the corner of every page</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Quick messages"
        onClick={() => setChatDockHidden(enabled)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1 disabled:opacity-50 ${
          enabled ? 'bg-brand' : 'bg-gray-300 dark:bg-stone-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        ></span>
      </button>
    </div>
  );
}
