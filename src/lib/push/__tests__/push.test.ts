import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  MAX_PUSHES_PER_RECIPIENT,
  PUSH_BODY_MAX,
  PUSH_FALLBACK_PATH,
  pushPayloadFor,
  pushTag,
  rowsToSend,
  safeAppPath,
  type PushNotificationRow,
} from '../payload';
import { urlBase64ToUint8Array } from '../keys';
import { deliveryUrl, pushReady, vapidConfig, PUSH_MOCK_HOST } from '../config-server';
import { pushSupportFrom } from '../client';

const row = (over: Partial<PushNotificationRow> = {}): PushNotificationRow => ({
  id: 'n1',
  type: 'comment',
  title: 'Sam commented on your post',
  message: 'Great round!',
  action_url: '/feed?comment=c1',
  post_id: 'p1',
  metadata: null,
  created_at: '2026-10-02T12:00:00.000Z',
  ...over,
});

describe('safeAppPath — a tap only ever opens a page of this app', () => {
  it('keeps a same-origin path', () => {
    expect(safeAppPath('/messages?c=abc')).toBe('/messages?c=abc');
    expect(safeAppPath('/events/123#live')).toBe('/events/123#live');
  });
  it('refuses everything else', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      'feed',
      '/feed\nSet-Cookie: x',
    ]) {
      expect(safeAppPath(bad as string | null)).toBe(PUSH_FALLBACK_PATH);
    }
  });
});

describe('pushPayloadFor', () => {
  it('carries the row, the unread count and a safe url', () => {
    expect(pushPayloadFor(row(), 7)).toEqual({
      id: 'n1',
      title: 'Sam commented on your post',
      body: 'Great round!',
      url: '/feed?comment=c1',
      badge: 7,
      tag: 'n:n1',
    });
  });
  it('clips a long body and never shows a direct message on the lock screen', () => {
    const long = pushPayloadFor(row({ message: 'x '.repeat(300) }), 1);
    expect(long.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(long.body.endsWith('…')).toBe(true);
    const dm = pushPayloadFor(
      row({ type: 'new_message', title: 'Sam sent you a message', message: 'my secret', metadata: { conversation_id: 'c9' } }),
      2
    );
    expect(dm.body).not.toContain('secret');
    expect(dm.title).toBe('Sam sent you a message');
    expect(dm.tag).toBe('message:c9');
  });
  it('a missing title and a nonsense count still make a valid payload', () => {
    const p = pushPayloadFor(row({ title: null, action_url: null }), Number.NaN);
    expect(p.title).toBe('Edge Athlete');
    expect(p.url).toBe(PUSH_FALLBACK_PATH);
    expect(p.badge).toBe(0);
  });
});

describe('tags and collapsing', () => {
  it('likes collapse per post, messages per conversation, the rest stand alone', () => {
    expect(pushTag(row({ type: 'like', post_id: 'p1' }))).toBe('like:p1');
    expect(pushTag(row({ type: 'new_message', metadata: { conversation_id: 'c1' } }))).toBe('message:c1');
    expect(pushTag(row({ type: 'new_message', metadata: null }))).toBe('n:n1');
    expect(pushTag(row({ type: 'follow_request' }))).toBe('n:n1');
  });
  it('ten likes in a minute are one buzz: the newest', () => {
    const likes = Array.from({ length: 10 }, (_, i) =>
      row({ id: `l${i}`, type: 'like', post_id: 'p1', created_at: `2026-10-02T12:00:0${i}.000Z` })
    );
    const out = rowsToSend([...likes, row({ id: 'c1', type: 'comment', created_at: '2026-10-02T11:59:00.000Z' })]);
    expect(out.map(r => r.id)).toEqual(['l9', 'c1']);
  });
  it('caps the buzzes per sweep', () => {
    expect(MAX_PUSHES_PER_RECIPIENT).toBeGreaterThan(0);
    expect(MAX_PUSHES_PER_RECIPIENT).toBeLessThanOrEqual(5);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a VAPID public key to its 65 raw bytes', () => {
    const raw = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    const text = Buffer.from(raw).toString('base64url');
    expect([...urlBase64ToUint8Array(text)]).toEqual([...raw]);
    expect([...urlBase64ToUint8Array(Buffer.from(raw).toString('base64'))]).toEqual([...raw]);
  });
  it('refuses a character outside the alphabet', () => {
    expect(() => urlBase64ToUint8Array('abc$')).toThrow();
  });
});

describe('config — fail closed, mock only outside production', () => {
  const keys = {
    VAPID_PUBLIC_KEY: 'B'.repeat(87),
    VAPID_PRIVATE_KEY: 'a'.repeat(43),
    VAPID_SUBJECT: 'mailto:ops@example.com',
  };
  it('needs all three, well-formed', () => {
    expect(pushReady(keys)).toBe(true);
    expect(vapidConfig({ ...keys, VAPID_PRIVATE_KEY: undefined })).toBeNull();
    expect(vapidConfig({ ...keys, VAPID_SUBJECT: 'ops@example.com' })).toBeNull();
    expect(vapidConfig({ ...keys, VAPID_PUBLIC_KEY: 'short' })).toBeNull();
    expect(pushReady({})).toBe(false);
  });
  it('routes only the e2e host to the mock, and never in production', () => {
    const env = { PUSH_MOCK_BASE: 'http://127.0.0.1:4872/' };
    expect(deliveryUrl(`https://${PUSH_MOCK_HOST}/s/1`, env)).toBe('http://127.0.0.1:4872/s/1');
    expect(deliveryUrl('https://fcm.googleapis.com/fcm/send/x', env)).toBe('https://fcm.googleapis.com/fcm/send/x');
    expect(deliveryUrl(`https://${PUSH_MOCK_HOST}/s/1`, { ...env, VERCEL_ENV: 'production' })).toBe(
      `https://${PUSH_MOCK_HOST}/s/1`
    );
  });
});

describe('pushSupportFrom — what this device can do', () => {
  it('an iPhone in a browser tab must open the home-screen app first', () => {
    expect(pushSupportFrom({ apis: false, isIos: true, standalone: false, permission: null })).toBe('needs-install');
    expect(pushSupportFrom({ apis: true, isIos: true, standalone: true, permission: 'default' })).toBe('available');
  });
  it('follows the permission elsewhere', () => {
    expect(pushSupportFrom({ apis: false, isIos: false, standalone: false, permission: null })).toBe('unsupported');
    expect(pushSupportFrom({ apis: true, isIos: false, standalone: false, permission: 'granted' })).toBe('granted');
    expect(pushSupportFrom({ apis: true, isIos: false, standalone: false, permission: 'denied' })).toBe('denied');
  });
});

describe('migration 248 and the code agree', () => {
  const sql = readFileSync(path.join(process.cwd(), 'database/migrations/248_push_notifications.sql'), 'utf8');
  it('names the columns the sender selects and the sweep stamps', () => {
    for (const col of ['endpoint', 'p256dh', 'auth', 'failure_count', 'last_success_at', 'profile_id']) {
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS pushed_at timestamptz');
  });
  it('carries no secret — the job copies the live urgent-emails header', () => {
    expect(sql).not.toMatch(/Bearer [A-Za-z0-9]/);
    expect(sql).toContain("jobname = 'urgent-emails'");
  });
  it('the worker reads the payload fields the server writes', () => {
    const sw = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    for (const field of ['title', 'body', 'url', 'badge', 'tag', 'id']) expect(sw).toContain(`data.${field}`);
    // Speed round 2 (Oct 4 2026): the worker MAY have a fetch handler, but
    // only the static cache's, gated on its own `?static=1` URL — the push
    // path never depends on it. The handler's rules are pinned in
    // src/lib/sw/__tests__/static-cache.test.ts; here: it is OFF unless asked.
    expect(sw).toMatch(/if \(!staticCacheOn\) return;/);
  });
});

describe('the feed card waits a week after "Not now", then asks again', () => {
  it('snoozes for exactly seven days', async () => {
    const { isSnoozed, parseSnooze, snoozeUntil, PUSH_CARD_SNOOZE_DAYS } = await import('../card');
    const now = Date.parse('2026-10-02T12:00:00.000Z');
    const until = parseSnooze(snoozeUntil(now));
    expect(until).toBe(now + PUSH_CARD_SNOOZE_DAYS * 86_400_000);
    expect(isSnoozed(until, now + 6 * 86_400_000)).toBe(true);
    expect(isSnoozed(until, now + 7 * 86_400_000)).toBe(false);
  });
  it('never snoozed, or an unreadable value, asks', async () => {
    const { isSnoozed, parseSnooze } = await import('../card');
    expect(isSnoozed(parseSnooze(null), Date.now())).toBe(false);
    expect(isSnoozed(parseSnooze('not a date'), Date.now())).toBe(false);
  });
});
