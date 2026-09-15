-- ============================================================================
-- 210: the day-before reminder bell — `sport_event_reminder` joins the
--      notifications type CHECK (Events program, phase 2b, B2 — Tom: "add
--      the reminder bell too")
-- ============================================================================
-- The daily cron (`/api/cron/daily`, the `sportEventReminders` step —
-- both Vercel cron slots are taken, so it is a step, not a cron) bells every
-- accepted participant (players and followers) of a round scheduled
-- TOMORROW (the UTC day, the 057 convention) on an event that is open or
-- live — once per (round, profile), keyed on the bell's metadata
-- (`sport_event_round_id`), the golf_league_window_closing precedent.
--
-- The re-ADD is the 205 shape: the full list verbatim + the one new type,
-- so the registry parity test's "latest re-declaration" is this file. Same
-- PR: `src/lib/notification-registry.ts` gains the entry (verify fails
-- otherwise). The sender is 23514-tolerant — before this file runs it logs
-- "run migration 210" and skips; nothing throws.
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
    'competition_entry_pending','competition_entry_decided',
    'org_registration_received','org_registration_placed','org_registration_released',
    'contest_dispute_raised','contest_dispute_resolved',
    'golf_league_round_counted','golf_league_round_confirmed','golf_league_window_closing',
    'org_staff_invite','org_staff_accepted','org_staff_revoked',
    'org_listing_request',
    'site_form_submission',
    'sport_event_invite','sport_event_request','sport_event_request_decision',
    'sport_event_live','sport_event_results',
    'sport_event_reminder'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 210 APPLIED | 65 | 1
SELECT '210 APPLIED' AS result,
       (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g')) AS types_expect_65,
       (pg_get_constraintdef(oid) LIKE '%sport_event_reminder%')::int AS carries_reminder_expect_1
  FROM pg_constraint WHERE conname = 'notifications_type_check';
