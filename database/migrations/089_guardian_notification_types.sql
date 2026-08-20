-- ============================================================================
-- Migration 089 — Guardian notification types
-- ============================================================================
-- Family console Round 1 (Aug 19 2026): guardians get in-app notifications.
-- 053 added 'guardian_invite' and 'athlete_added' to the CHECK constraint but
-- nothing ever wrote them; the app now inserts these plus four new types
-- (src/lib/guardian-notify.ts):
--
--   post_pending_approval  a supervised athlete's post entered the queue
--   post_approval_result   guardian approved/rejected the athlete's post
--   transfer_update        transfer needs a party / age-in eligibility
--   consent_result         admin approved/rejected the consent review
--
-- Full-list re-ADD, the 028/053/059 house pattern. Base list = 059's live
-- list (the LAST migration to touch this constraint — verified).

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
    'consent_result'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (paste any time) ──────────────────────────────────
-- Expect one row; new_types_present = true.
SELECT
  conname,
  (pg_get_constraintdef(oid) LIKE '%post_pending_approval%'
   AND pg_get_constraintdef(oid) LIKE '%transfer_update%'
   AND pg_get_constraintdef(oid) LIKE '%consent_result%'
   AND pg_get_constraintdef(oid) LIKE '%post_approval_result%'
   AND pg_get_constraintdef(oid) LIKE '%event_reminder%') AS new_types_present
FROM pg_constraint
WHERE conname = 'notifications_type_check';
