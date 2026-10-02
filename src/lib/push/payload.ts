/**
 * What a phone notification says and where its tap goes (Oct 2026). Pure, no
 * imports — the sweep (server) builds it and the service worker (`public/
 * sw.js`) only reads it, so this file IS the contract between them.
 *
 * Tom's rules: everything the bell gets is pushed; a tap opens the exact item
 * (the row's own `action_url`, written by its writer — there is no type → URL
 * map anywhere); likes on the same post replace each other on the lock screen
 * instead of stacking; the icon number is the bell's unread count.
 */

export interface PushNotificationRow {
  id: string;
  type: string;
  title: string | null;
  message: string | null;
  action_url: string | null;
  post_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PushPayload {
  /** The notification's id — the worker marks it read on tap. */
  id: string;
  title: string;
  body: string;
  /** A same-origin path, always (`safeAppPath`). */
  url: string;
  /** The number for the app icon: the bell's unread count. */
  badge: number;
  /** Notifications sharing a tag replace each other on the device. */
  tag: string;
}

/** Where a tap lands when the row names nowhere usable. */
export const PUSH_FALLBACK_PATH = '/app/notifications';
export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 140;

/**
 * A tap may only ever open a page of THIS app: a relative path starting with
 * a single `/`. Anything else — an absolute URL, `//host`, a backslash trick,
 * a `javascript:` — falls back to the notifications page.
 */
export function safeAppPath(url: string | null | undefined): string {
  if (typeof url !== 'string') return PUSH_FALLBACK_PATH;
  const trimmed = url.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return PUSH_FALLBACK_PATH;
  }
  // Control characters have no place in a path (and would let a header or a
  // log line be split).
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return PUSH_FALLBACK_PATH;
  }
  return trimmed;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

function metaString(metadata: PushNotificationRow['metadata'], key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Likes on one post collapse; a conversation's messages collapse; anything
 *  else stands alone. */
export function pushTag(row: Pick<PushNotificationRow, 'id' | 'type' | 'post_id' | 'metadata'>): string {
  if (row.type === 'like' && row.post_id) return `like:${row.post_id}`;
  if (row.type === 'new_message') {
    const conversation = metaString(row.metadata, 'conversation_id');
    if (conversation) return `message:${conversation}`;
  }
  return `n:${row.id}`;
}

/** The lock screen never shows a direct message's words — the title already
 *  says who wrote; the text is one tap away, behind the phone's own lock. */
const PRIVATE_BODY_TYPES = new Set(['new_message']);
const PRIVATE_BODY = 'Tap to read';

export function pushPayloadFor(row: PushNotificationRow, unreadCount: number): PushPayload {
  const title = clip(row.title?.trim() || 'Edge Athlete', PUSH_TITLE_MAX);
  const body = PRIVATE_BODY_TYPES.has(row.type) ? PRIVATE_BODY : clip(row.message ?? '', PUSH_BODY_MAX);
  return {
    id: row.id,
    title,
    body,
    url: safeAppPath(row.action_url),
    badge: Math.max(0, Math.floor(Number.isFinite(unreadCount) ? unreadCount : 0)),
    tag: pushTag(row),
  };
}

/**
 * One recipient's pending rows → what to send. Rows sharing a tag would
 * replace each other on the device anyway, so only the NEWEST of each is
 * sent (ten likes in a minute are one buzz, not ten). Newest first.
 */
export function rowsToSend<T extends Pick<PushNotificationRow, 'id' | 'type' | 'post_id' | 'metadata' | 'created_at'>>(
  rows: readonly T[]
): T[] {
  const newest = new Map<string, T>();
  for (const row of rows) {
    const tag = pushTag(row);
    const held = newest.get(tag);
    if (!held || row.created_at > held.created_at) newest.set(tag, row);
  }
  return [...newest.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** At most this many buzzes per person per sweep — a burst (an org
 *  announcement plus a busy thread) stays readable; the badge still counts
 *  everything. */
export const MAX_PUSHES_PER_RECIPIENT = 3;
