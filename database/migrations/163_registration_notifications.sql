-- ============================================================================
-- 163: registration notification types — the CHECK widens 46 → 49 (phase 5 R4)
-- ============================================================================
-- The 154 ritual, verbatim: DROP the named CHECK, re-ADD the FULL list
-- with the three registration types appended. Bells: a new registration
-- fans out to the org's managers (the competitions/notify.ts
-- orgManagerIds pattern); placed/released go to the athlete and — when
-- supervised — their guardians (the roster-invite cross-notify model).
--
-- ORDER-STRICT: run AFTER 162 (any order relative to the R4 deploy —
-- the senders are best-effort and a 23514 on an old CHECK only drops the
-- bell, never the transition). Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): re-ADD the 154
-- 46-type list (rows of the three new types must be deleted first).

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
    'org_registration_received','org_registration_placed','org_registration_released'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%org_registration_received%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')  AS received_present,
  (SELECT pg_get_constraintdef(oid) LIKE '%org_registration_placed%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')  AS placed_present,
  (SELECT pg_get_constraintdef(oid) LIKE '%org_registration_released%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')  AS released_present,
  (SELECT pg_get_constraintdef(oid) LIKE '%roster_invite%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')  AS prior_types_kept;
