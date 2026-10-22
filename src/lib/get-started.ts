/**
 * The Get Started card's dismissal (fix round, Oct 2026) — pure, zero imports.
 *
 * Tom: "If the user closes the suggestions, they should stay closed." The X
 * was remembered in ONE browser's localStorage under a key that was not even
 * per account — so any fresh storage showed the card again for the rest of
 * its 14-day window: a second device, a private window, and the app installed
 * from the home screen (an installed web app keeps its own storage).
 *
 * The dismissal now lives on the ACCOUNT (the auth user's metadata, written
 * by /api/profile/getting-started — no migration) and the browser key is only
 * the fast path that saves the request.
 */

/** The pre-Oct-2026 key: one per browser, shared by every account on it. Still honoured. */
export const LEGACY_DISMISS_KEY = 'ea:get-started:dismissed:v1';

export function dismissKeyFor(userId: string): string {
  return `${LEGACY_DISMISS_KEY}:${userId}`;
}

/** The auth-metadata field the dismissal is stamped on. */
export const DISMISSED_META_KEY = 'get_started_dismissed_at';

export function isDismissedInMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const v = (metadata as Record<string, unknown>)[DISMISSED_META_KEY];
  return typeof v === 'string' && v.length > 0;
}

/** Fired on `window` when the card is closed — the install card waits its turn. */
export const GET_STARTED_DISMISSED_EVENT = 'ea:get-started-dismissed';

/** Accounts older than this never see the card, even with unmet steps. */
export const NEW_ACCOUNT_WINDOW_DAYS = 14;

/**
 * The card holds its place from the FIRST paint (Oct 22 2026, Tom: "reserve
 * its space"). On a cold load its steps API answered ~2.3 s in and the card
 * then pushed the feed down 246 px (CLS 0.35 on a mid-range Android). The
 * client already knows most of what decides the card: the account's age, its
 * kind, and whether THIS device closed it — so the card mounts at once in a
 * resolving state when those say it may show, and the API only fills in the
 * two steps it alone can answer. The cross-device dismissal still arrives
 * with the API (rare: it is then remembered on this device too).
 */
export function shouldReserveGetStarted(
  input: { createdAt: string | null | undefined; userType: string | null | undefined; browserDismissed: boolean },
  now: number
): boolean {
  if (!input.createdAt || input.browserDismissed) return false;
  if (input.userType === 'organizer') return false;
  const created = new Date(input.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created < NEW_ACCOUNT_WINDOW_DAYS * 86_400_000;
}
