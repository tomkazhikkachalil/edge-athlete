-- ============================================================================
-- 154: competition entry notification types (phase 2, round 4)
-- ============================================================================
-- Cross-org rep entries (the masterplan's "rep season" half of the
-- phase-2 exit) arrive as PENDING and get decided — two new notification
-- types ride the house DROP+ADD full-list swap (base = 147's list
-- verbatim, plus two):
--   * competition_entry_pending — to the owner org's managers when an
--     affiliated club's team is entered and awaits their decision.
--   * competition_entry_decided — to the entering club's managers when
--     the owner approves or rejects (metadata carries the outcome).
--
-- The registry parity test (src/lib/__tests__/notification-registry.
-- test.ts) parses THIS file's list — the registry + frozen bucket
-- arrays land in the same round's PR or `npm run verify` fails, which
-- is the point (the 0.1 gate working as designed).
--
-- ORDER-STRICT: run AFTER 153, BEFORE merging the R4 notifications PR
-- (an unsent-but-allowed type is harmless; the reverse is a 23514).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): re-ADD the constraint
-- with 147's 44-type list (rows of the two new types must be deleted
-- first or the narrow re-ADD fails validation).
-- ============================================================================

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
    'roster_invite',
    'competition_entry_pending','competition_entry_decided'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%competition_entry_pending%'
     AND pg_get_constraintdef(oid) LIKE '%competition_entry_decided%'
     AND pg_get_constraintdef(oid) LIKE '%roster_invite%'
   FROM pg_constraint WHERE conname = 'notifications_type_check') AS type_check_carries_all,
  (SELECT COUNT(*) FROM notifications
   WHERE type IN ('competition_entry_pending','competition_entry_decided')) AS entry_type_rows_info;
-- Expect: true, then one info count (0 on first run).
