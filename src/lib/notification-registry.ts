// ── Notification type registry — the ONE place a notification type's UI
// mapping lives (0.1 of the org-platform phase 0) ────────────────────────────
//
// Before this file, registering a type meant editing three hardcoded maps
// (the notifications page's tab arrays + icon switch, and NotificationBell's
// near-duplicate switch, which had already drifted). The org platform adds
// ~10 more types; this registry plus its parity test
// (src/lib/__tests__/notification-registry.test.ts, which parses the latest
// notifications_type_check migration) makes "migration adds a type" fail
// `npm run verify` until the type is registered here.
//
// A flat file on purpose: `src/lib/notifications.tsx` already exists, so a
// `notifications/` directory would shadow the `@/lib/notifications`
// specifier. Client-safe: pure data and pure functions only.
//
// Deliberately NOT folded in (different domains):
// - getNotificationText (src/lib/notifications.tsx) — the frozen-title
//   fallback is load-bearing for org/guardian senders.
// - Preference toggles (Zod allowlist + NotificationSettings GROUPS) — keyed
//   by preference COLUMNS, each added by a migration. A `prefColumn?` field
//   here is the future bridge, added when a step adds a toggleable type.
// - GuardianNotificationType (guardian-notify.ts) — a sender-side allowlist.
// - The guardian queue icon map — keyed by QueueItem.kind, not by type.

/** Which named tab on /app/notifications shows the type. `null` = reachable
 *  only via All/Unread — today's real behavior for 19 of the 44 types, and
 *  the safe default for a type the DB knows but this build doesn't. */
export type NotificationTab = 'follow' | 'engagement' | 'system' | null;

interface NotificationTypeMeta {
  tab: NotificationTab;
  /** FontAwesome class. Absent → 'fa-bell', exactly the old default case. */
  icon?: string;
}

export const NOTIFICATION_TYPE_META = {
  // Follow tab
  follow_request: { tab: 'follow', icon: 'fa-user-plus' },
  follow_accepted: { tab: 'follow', icon: 'fa-user-plus' },
  new_follower: { tab: 'follow', icon: 'fa-user-plus' },
  // Engagement tab
  like: { tab: 'engagement', icon: 'fa-heart' },
  comment: { tab: 'engagement', icon: 'fa-comment' },
  comment_reply: { tab: 'engagement', icon: 'fa-comment' },
  mention: { tab: 'engagement', icon: 'fa-at' },
  tag: { tab: 'engagement', icon: 'fa-at' },
  // System tab
  achievement: { tab: 'system', icon: 'fa-trophy' },
  system_announcement: { tab: 'system', icon: 'fa-bullhorn' },
  club_update: { tab: 'system', icon: 'fa-users' },
  team_update: { tab: 'system', icon: 'fa-users' },
  event_invite: { tab: 'system' },
  event_update: { tab: 'system' },
  event_cancelled: { tab: 'system' },
  event_response: { tab: 'system' },
  post_pending_approval: { tab: 'system', icon: 'fa-hourglass-half' },
  post_approval_result: { tab: 'system', icon: 'fa-user-shield' },
  comment_pending_approval: { tab: 'system', icon: 'fa-hourglass-half' },
  comment_approval_result: { tab: 'system', icon: 'fa-user-shield' },
  transfer_update: { tab: 'system', icon: 'fa-right-left' },
  consent_result: { tab: 'system', icon: 'fa-user-shield' },
  athlete_added: { tab: 'system', icon: 'fa-child-reaching' },
  safety_alert: { tab: 'system', icon: 'fa-shield-halved' },
  calendar_alert: { tab: 'system', icon: 'fa-calendar-day' },
  // All/Unread only (tab: null) — preserved from the pre-registry behavior,
  // where these types appeared in no named tab's array.
  new_message: { tab: null },
  group_invite: { tab: null, icon: 'fa-users' },
  group_update: { tab: null, icon: 'fa-trophy' },
  guardian_invite: { tab: null },
  event_reminder: { tab: null },
  follow_request_guardian: { tab: null },
  follow_update: { tab: null },
  tag_alert: { tab: null },
  profile_change: { tab: null },
  league_join: { tab: null },
  league_update: { tab: null },
  league_request_result: { tab: null },
  club_join: { tab: null },
  club_request_result: { tab: null },
  affiliation_invite: { tab: null },
  affiliation_update: { tab: null },
  carpool_offer: { tab: null },
  carpool_update: { tab: null },
  // 0.10 (mig 147): guardian-facing roster bell — sits with its guardian
  // siblings in the All/Unread-only bucket.
  roster_invite: { tab: null, icon: 'fa-clipboard-list' },
} as const satisfies Record<string, NotificationTypeMeta>;

export type KnownNotificationType = keyof typeof NOTIFICATION_TYPE_META;

function metaFor(type: string): NotificationTypeMeta | undefined {
  return (NOTIFICATION_TYPE_META as Record<string, NotificationTypeMeta>)[type];
}

export function getNotificationIcon(type: string): string {
  return metaFor(type)?.icon ?? 'fa-bell';
}

export function notificationTab(type: string): NotificationTab {
  return metaFor(type)?.tab ?? null;
}
