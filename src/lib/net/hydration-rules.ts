/**
 * The device store's RULES (performance program, Phase 2b — Nov 2026). Pure,
 * zero imports; device-store.ts applies them and
 * src/lib/__tests__/hydration-rules.test.ts pins them.
 *
 * WHY. The installed app reopened to an empty shell: the header had no name,
 * the badges no numbers, the feed a spinner — until the session was checked,
 * the profile read and the first page fetched, every one of them a round trip
 * (and after a deploy, a cold function). Tom's decision (Nov 7 2026): the
 * profile, the counts and the LAST FEED PAGE may live on the device, keyed by
 * the account, cleared on sign-out and on a 401, so the shell paints at once
 * from what it had and revalidates behind it.
 *
 * What may be stored is an ALLOWLIST (`HYDRATION_KINDS`); each kind has a
 * lifetime past which the copy is ignored; every key carries the user id so
 * one account never paints another's data on a shared phone.
 */

export const HYDRATION_PREFIX = 'ea:hyd:v1:';

/** What may be stored, and for how long a copy is worth painting. */
export const HYDRATION_KINDS = Object.freeze({
  profile: 7 * 24 * 60 * 60_000,
  pulse: 24 * 60 * 60_000,
  feed: 24 * 60 * 60_000,
});
export type HydrationKind = keyof typeof HYDRATION_KINDS;

export interface DeviceEnvelope<T> {
  v: 1;
  userId: string;
  savedAt: number;
  value: T;
}

/** `ea:hyd:v1:<userId>:<kind>` — the id first, so one account's keys are one prefix. */
export function hydrationKey(userId: string, kind: HydrationKind): string {
  return `${HYDRATION_PREFIX}${userId}:${kind}`;
}

export function isHydrationKey(key: string): boolean {
  return key.startsWith(HYDRATION_PREFIX);
}

/** A copy is worth painting when it is this account's, this shape's, and within the kind's lifetime. */
export function acceptEnvelope<T>(raw: unknown, userId: string, kind: HydrationKind, now: number): T | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<DeviceEnvelope<T>>;
  if (e.v !== 1 || e.userId !== userId || typeof e.savedAt !== 'number') return null;
  if (now - e.savedAt > HYDRATION_KINDS[kind] || now < e.savedAt - 60_000) return null;
  return e.value === undefined ? null : (e.value as T);
}

export function makeEnvelope<T>(userId: string, value: T, now: number): DeviceEnvelope<T> {
  return { v: 1, userId, savedAt: now, value };
}

/** The feed keeps the first page only, capped — a device copy is a paint, not an archive. */
export const FEED_DEVICE_MAX_POSTS = 20;
export function trimFeedForDevice<P>(posts: readonly P[]): P[] {
  return posts.slice(0, FEED_DEVICE_MAX_POSTS);
}
