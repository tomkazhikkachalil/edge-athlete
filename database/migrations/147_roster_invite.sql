-- ============================================================================
-- 147: roster_invite — the guardian roster bell (phase 0, 0.10)
-- ============================================================================
-- The dedicated notification type 0.3 reserved ("rides league_update on
-- purpose — the dedicated roster type arrives with 0.10's guardian queue").
-- GUARDIAN-FACING ONLY (Tom, Aug 31): guardians are belled when an org
-- offers their supervised athlete a roster spot, and when the child
-- self-accepts (either-approves — the follow convention). Adult-facing
-- roster senders STAY on league_update/club_update + metadata.roster.
--
-- Sender is a direct admin insert (guardian-notify convention —
-- create_notification's preference gate has no branch for this type and
-- would silently drop it). The registry parity test forces the
-- src/lib/notification-registry.ts entry to land with this migration.
--
-- ORDER-STRICT: run BEFORE merging the 0.10 PR (its senders write this
-- type). Run AFTER 139 (this re-declares 139's full list + one). Re-runnable.
-- ============================================================================

-- ── Notification types: full-list re-ADD (base = 139's exact live list).
-- One addition: roster_invite. ───────────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result',
    'follow_request_guardian','follow_update','tag_alert','profile_change',
    'calendar_alert','safety_alert',
    'league_join','league_update','league_request_result',
    'club_join','club_request_result','affiliation_invite','affiliation_update',
    'carpool_offer','carpool_update',
    'roster_invite'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%roster_invite%'
     AND pg_get_constraintdef(oid) LIKE '%carpool_update%'
   FROM pg_constraint WHERE conname = 'notifications_type_check') AS type_check_carries_both,
  (SELECT COUNT(*) FROM notifications WHERE type = 'roster_invite') AS roster_invite_rows_info;
-- Expect: true, then one info count (0 on first run).
