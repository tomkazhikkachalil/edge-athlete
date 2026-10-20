import { COPY } from '@/lib/copy';

/**
 * Who sees what you post (Oct 9 2026, Tom): the ACCOUNT decides — a public
 * account means anyone, a private one means your approved fans. There is
 * never a per-post "followers only" choice: a post is written
 * `visibility: 'public'` and the feed's rule applies the account's privacy.
 *
 * Oct 19 2026 (269, Tom: "Only me" is dropped): the one per-item choice is
 * "Post to feed" ON / OFF — a SWITCH (posts.on_feed), not an audience. Off
 * means not on the feed; it still stands on the profile (Stats, Training)
 * for whoever the account lets in. Remembered per kind: feed-memory.ts.
 */

/** Where a post goes is decided by the account; a post is always written public. */
export const POST_VISIBILITY = 'public' as const;

/** The settings page that changes the account's privacy. */
export const PRIVACY_SETTINGS_HREF = '/settings?tab=privacy';

/** True when the account is private (anything but an explicit 'public'). */
export function isPrivateAccount(accountVisibility: string | null | undefined): boolean {
  return accountVisibility !== 'public';
}

/** The line under the switch when it is ON: who will see it, from the account's privacy. */
export function whoSeesPost(accountVisibility: string | null | undefined): string {
  return isPrivateAccount(accountVisibility) ? COPY.AUDIENCE.WHO_PRIVATE : COPY.AUDIENCE.WHO_PUBLIC;
}

/** The line under the switch when it is OFF, with where the item stands (e.g. "in Training"). */
export function feedOffLine(place?: string): string {
  return place ? `${COPY.AUDIENCE.FEED_OFF_LINE}, ${place}` : COPY.AUDIENCE.FEED_OFF_LINE;
}
