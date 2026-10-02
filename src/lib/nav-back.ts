/**
 * "Back" that is never a dead end (Oct 2026, with Download the app). A page
 * opened COLD has no history to go back to: the installed app has no browser
 * Back button, Android opens edgeathlete.ca links inside it, and a link
 * opened in a new tab is the same case in a browser. `router.back()` there
 * does nothing — the button reads as broken. So: back when there is
 * somewhere to go back to, else the page's natural parent.
 */

/** A lone history entry is this page itself. */
export function hasBackHistory(historyLength: number): boolean {
  return historyLength > 1;
}

interface BackRouter {
  back: () => void;
  push: (href: string) => void;
}

export function backOr(router: BackRouter, fallback: string): void {
  if (typeof window !== 'undefined' && hasBackHistory(window.history.length)) router.back();
  else router.push(fallback);
}
