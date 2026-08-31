import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NOTIFICATION_TYPE_META,
  getNotificationIcon,
  notificationTab,
} from '../notification-registry';

/** The latest full re-declaration of notifications_type_check in
 *  database/migrations/. Every re-ADD since 003 repeats the constraint name
 *  and the complete literal list, so the highest-numbered matching file IS
 *  the live CHECK. Parsing it (instead of keeping a literal copy here) is
 *  what makes "a migration adds a type" fail `npm run verify` until the type
 *  is registered — a copy only fails if someone remembers to update it. */
function liveCheckTypes(): { file: string; types: string[] } {
  const dir = path.join(process.cwd(), 'database', 'migrations');
  const pattern = /notifications_type_check CHECK \(type IN \(([\s\S]*?)\)\)/;
  const files = fs
    .readdirSync(dir)
    .filter(f => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  let latest: { file: string; types: string[] } | null = null;
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const match = text.match(pattern);
    if (!match) continue;
    const types = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    if (types.length > 0) latest = { file, types };
  }
  if (!latest) {
    throw new Error(
      'No migration matched the notifications_type_check pattern — if the constraint was renamed or reshaped, update this parser.'
    );
  }
  return latest;
}

describe('notification registry ↔ DB CHECK parity', () => {
  it('registry keys equal the latest notifications_type_check list exactly', () => {
    const { file, types } = liveCheckTypes();
    const dbTypes = [...types].sort();
    const registryTypes = Object.keys(NOTIFICATION_TYPE_META).sort();
    // A mismatch means a migration added/removed a type without updating
    // src/lib/notification-registry.ts (or vice versa). Latest source: `file`.
    expect(registryTypes, `parsed from ${file}`).toEqual(dbTypes);
  });

  it('the DB list has no duplicates', () => {
    const { types } = liveCheckTypes();
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('tab buckets (behavior frozen from the pre-registry literal arrays)', () => {
  const bucket = (tab: string | null) =>
    Object.entries(NOTIFICATION_TYPE_META)
      .filter(([, meta]) => meta.tab === tab)
      .map(([type]) => type)
      .sort();

  it('follow', () => {
    expect(bucket('follow')).toEqual(['follow_accepted', 'follow_request', 'new_follower']);
  });

  it('engagement', () => {
    expect(bucket('engagement')).toEqual(['comment', 'comment_reply', 'like', 'mention', 'tag']);
  });

  it('system', () => {
    expect(bucket('system')).toEqual([
      'achievement',
      'athlete_added',
      'calendar_alert',
      'club_update',
      'comment_approval_result',
      'comment_pending_approval',
      'consent_result',
      'event_cancelled',
      'event_invite',
      'event_response',
      'event_update',
      'post_approval_result',
      'post_pending_approval',
      'safety_alert',
      'system_announcement',
      'team_update',
      'transfer_update',
    ]);
  });

  it('All/Unread-only (tab: null) — the 19 types no named tab listed', () => {
    expect(bucket(null)).toEqual([
      'affiliation_invite',
      'affiliation_update',
      'carpool_offer',
      'carpool_update',
      'club_join',
      'club_request_result',
      'competition_entry_decided',
      'competition_entry_pending',
      'event_reminder',
      'follow_request_guardian',
      'follow_update',
      'group_invite',
      'group_update',
      'guardian_invite',
      'league_join',
      'league_request_result',
      'league_update',
      'new_message',
      'profile_change',
      'roster_invite',
      'tag_alert',
    ]);
  });
});

describe('lookups and fallbacks', () => {
  it('icons resolve; absent icons and unknown types fall to fa-bell', () => {
    expect(getNotificationIcon('like')).toBe('fa-heart');
    expect(getNotificationIcon('transfer_update')).toBe('fa-right-left');
    expect(getNotificationIcon('event_invite')).toBe('fa-bell'); // never had a case
    expect(getNotificationIcon('not_a_type')).toBe('fa-bell');
  });

  it('unknown types belong to no named tab (All/Unread reachability preserved)', () => {
    expect(notificationTab('not_a_type')).toBeNull();
    expect(notificationTab('like')).toBe('engagement');
  });
});
