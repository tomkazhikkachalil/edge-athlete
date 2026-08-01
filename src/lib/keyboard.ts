/**
 * Global keyboard-shortcut rules.
 *
 * Pure and separate from the component because the *rules* are where the bugs
 * live — "does ⌘K fire while someone is typing a caption?" is a question with a
 * right answer that can be tested, and this repo has no jsdom, so a component
 * test is not an option.
 *
 * Context: before this there was no global shortcut system at all in the app.
 * Several components (`MediaLightbox`, `PostDetailModal`) already listen on
 * `window` for Escape and arrow keys and none of them stop propagation, so any
 * new global listener has to be a careful neighbour rather than assume it is
 * alone.
 */

/** Minimal shape so this stays testable without a DOM. */
interface ShortcutEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Is this the "open search" shortcut?
 *
 * ⌘K on Mac, Ctrl+K elsewhere — accepting both rather than sniffing the
 * platform, because a Mac user on an external PC keyboard presses Ctrl and a
 * platform check would leave them with nothing.
 *
 * Plain "/" also opens it, which is the second-nature key for search on the
 * web — but only when unmodified, or it would swallow ⌥/ and similar.
 */
export function matchesSearchShortcut(e: ShortcutEvent): boolean {
  if (e.key === 'k' || e.key === 'K') {
    // Require exactly one of meta/ctrl. Bare "k" must stay a letter.
    if (!e.metaKey && !e.ctrlKey) return false;
    // ⌘⇧K and ⌘⌥K belong to the browser and to other tools.
    return !e.altKey && !e.shiftKey;
  }

  if (e.key === '/') {
    return !e.metaKey && !e.ctrlKey && !e.altKey;
  }

  return false;
}

/**
 * Is the event coming from somewhere the user is composing text?
 *
 * Without this, "/" would be unusable inside every caption, message and search
 * field in the app — the single most common way a global shortcut becomes
 * hostile.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;

  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };

  if (el.isContentEditable) return true;

  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  // A custom control can opt in the same way assistive tech understands.
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}
