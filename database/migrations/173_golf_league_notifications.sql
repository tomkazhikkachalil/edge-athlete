-- ============================================================================
-- 173: golf league notification types — the CHECK widens 51 → 54 (phase 6d W2)
-- ============================================================================
-- The 154 ritual, verbatim: DROP the named CHECK, re-ADD the FULL list
-- (168's 51 types) with the three golf-league types appended. Bells: a
-- member's posted round COUNTED for a league week (the sync engine),
-- a week CONFIRMED by the organizer (rank included), and a WINDOW
-- CLOSING tomorrow with nothing posted yet (the daily cron, once per
-- member per round). Each goes to the member and — when supervised — to
-- their guardians (the registration cross-notify model).
--
-- ORDER-STRICT: run AFTER 172 (any order relative to the W2 deploy — the
-- senders are best-effort and a 23514 on the old CHECK only drops the
-- bell, never the sync, the confirm or the cron). Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): re-ADD the 168
-- 51-type list (rows of the three new types must be deleted first).

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
    'competition_entry_pending','competition_entry_decided',
    'org_registration_received','org_registration_placed','org_registration_released',
    'contest_dispute_raised','contest_dispute_resolved',
    'golf_league_round_counted','golf_league_round_confirmed','golf_league_window_closing'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check')       AS type_check,
  (SELECT pg_get_constraintdef(oid) LIKE '%golf_league_round_counted%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')                     AS counted_allowed,
  (SELECT pg_get_constraintdef(oid) LIKE '%golf_league_round_confirmed%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')                     AS confirmed_allowed,
  (SELECT pg_get_constraintdef(oid) LIKE '%golf_league_window_closing%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')                     AS closing_allowed,
  (SELECT count(*) FROM notifications WHERE type LIKE 'golf_league_%')                  AS golf_league_bells;
