-- ============================================================================
-- 259: session_reminder — the day-before bell for an unfinished session
--      (resume pill program, PR 3, Oct 12 2026; runs on BOTH staging and
--      prod before the PR deploys — the sender tolerates 23514 until then)
-- ============================================================================
-- Tom's spec: "An unfinished session is kept for 7 days from when it was
-- last active … After 7 days with no activity … Send a reminder a day
-- before so the user can save it first." The 7-day rule already exists
-- (the Drafts round's daily sweeps: a scored round or an active workout is
-- FINISHED as played, a scoreless round DISCARDED — Tom, Oct 6 and again
-- Oct 12: nothing recorded is ever deleted); this adds the one bell before
-- it, sent by the daily cron to the round's creator / the workout's owner
-- when the session's clock is between 6 and 7 days old, ONCE per session
-- (deduped on the bell's metadata — the sport_event_reminder precedent, no
-- new column). The push sweep sends it to the phone like any other bell.
--
--   notifications_type_check gains 'session_reminder' — the 244 list,
--   re-declared whole (every re-ADD since 003 repeats the complete literal
--   list: notification-registry.test.ts parses the highest-numbered one).
--
-- REVERSAL: re-ADD notifications_type_check from 244. Re-runnable until the
-- ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 259) THEN
    RAISE EXCEPTION '259 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 258 THEN RAISE EXCEPTION '259 pre-flight: ledger head is %, expected 258', n; END IF;
END $$;

-- ── 1. notifications: the 244 list + session_reminder ───────────────────────
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
    'sport_event_reminder',
    'sport_event_match',
    'ticket_update','ticket_critical',
    'moderation_notice',
    'authority_notice',
    'team_roster',
    'challenge','challenge_result',
    'session_reminder'
  ));

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (259, '259_session_reminder.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 259 APPLIED | true | 259
SELECT '259 APPLIED' AS result,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check') LIKE '%session_reminder%' AS type_allowed_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_259;
