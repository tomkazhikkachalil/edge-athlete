-- ============================================================================
-- 205: the sport_event_* notification types (Events program, phase 1)
-- ============================================================================
-- Five bells for the Event lifecycle. `event_*` was NOT available: the
-- calendar owns event_invite / event_update / event_cancelled /
-- event_response / event_reminder (057+), which is why the whole family is
-- `sport_event_*`.
--   sport_event_invite            the organizer invited you (+ a guardian
--                                 copy for a supervised invitee) — actionable
--   sport_event_request           someone asked to join (to organizers) —
--                                 actionable
--   sport_event_request_decision  your request was approved / declined, or
--                                 the waitlist promoted you
--   sport_event_live              registered, NOT sent in phase 1 (the Live
--                                 Now strip is the surface) — here so the
--                                 CHECK is not re-ADDed for one type later
--   sport_event_results           results are in (+ a guardian copy)
-- Senders INSERT into notifications directly (create_notification drops
-- types outside its hardcoded ten — the guardian-notify.ts precedent).
-- Same PR: src/lib/notification-registry.ts entries — the parity test fails
-- `npm run verify` until every type below is registered.
--
-- The re-ADD is the 187 shape: the full list verbatim + the five, so the
-- parity test's "latest re-declaration" is this file.
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
    'sport_event_live','sport_event_results'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'type check carries the five' AS check_name, 'true' AS expected,
       (pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%')::text AS actual,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'type check still carries the old ones', 'true',
       (pg_get_constraintdef(oid) LIKE '%site_form_submission%' AND pg_get_constraintdef(oid) LIKE '%follow_request%')::text,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%site_form_submission%' AND pg_get_constraintdef(oid) LIKE '%follow_request%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'exactly one type check', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

ORDER BY 1;
