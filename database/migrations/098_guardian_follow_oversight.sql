-- ============================================================================
-- 098: Guardian gap-closure arc — notification types (Rounds G–J)
-- ============================================================================
-- ORDER-STRICT: run BEFORE merging the Round G PR — its senders insert these
-- types and the constraint would reject them.
--
-- Full-list re-ADD, the 028/053/059/089/095 house pattern. Base list = 095's
-- live list (the LAST migration to touch this constraint) + the SIX types the
-- gap-closure arc introduces. All six land now on purpose: front-loading the
-- constraint work makes Rounds H–J migration-free (senders arrive per round;
-- an allowed-but-unsent type is harmless, the reverse is a 23514 in prod).
--
--   follow_request_guardian  G: someone wants to follow a supervised athlete
--   follow_update            G: the other party's accept, cross-notified
--   tag_alert                H: a supervised athlete was tagged in a post
--   profile_change           H: a supervised athlete edited identity fields
--   calendar_alert           I: an event invite reached a supervised athlete
--   safety_alert             H/I: reports, password changes, equipment media
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
    'calendar_alert','safety_alert'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect: every column true.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%follow_request_guardian%' AS has_follow_request_guardian,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%follow_update%' AS has_follow_update,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%tag_alert%' AS has_tag_alert,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%profile_change%' AS has_profile_change,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%calendar_alert%' AS has_calendar_alert,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%safety_alert%' AS has_safety_alert,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%comment_pending_approval%' AS kept_095_types;
