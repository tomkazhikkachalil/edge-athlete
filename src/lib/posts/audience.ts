import { COPY } from '@/lib/copy';

/**
 * Who sees what you post (Oct 9 2026, Tom): the ACCOUNT decides — a public
 * account means anyone, a private one means your approved fans. The only
 * per-item choice is Post it or Only me (not on the feed; only you see it).
 * There is never a per-post "followers only" choice: a post is written
 * `visibility: 'public'` and the feed's rule applies the account's privacy.
 */
export type PostChoice = 'post' | 'only_me';

export const DEFAULT_CHOICE: PostChoice = 'post';

/** Where a post goes is decided by the account; a post is always written public. */
export const POST_VISIBILITY = 'public' as const;

/** The settings page that changes the account's privacy. */
export const PRIVACY_SETTINGS_HREF = '/settings?tab=privacy';

/** True when the account is private (anything but an explicit 'public'). */
export function isPrivateAccount(accountVisibility: string | null | undefined): boolean {
  return accountVisibility !== 'public';
}

/** The line under "Post it": who will see it, from the account's privacy. */
export function whoSeesPost(accountVisibility: string | null | undefined): string {
  return isPrivateAccount(accountVisibility) ? COPY.AUDIENCE.WHO_PRIVATE : COPY.AUDIENCE.WHO_PUBLIC;
}

/** The line under "Only me", with the place it is kept (e.g. "in your Vitals"). */
export function onlyMeLine(place?: string): string {
  return place ? `${COPY.AUDIENCE.ONLY_ME_LINE}, ${place}` : COPY.AUDIENCE.ONLY_ME_LINE;
}
