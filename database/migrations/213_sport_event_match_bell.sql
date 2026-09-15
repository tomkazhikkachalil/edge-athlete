-- ============================================================================
-- 213: the match bells — `sport_event_match` joins the notifications type
--      CHECK (Events program, phase 3, PR 12 — Tom: "match bells ship in
--      this phase")
-- ============================================================================
-- ONE type, three copies by `metadata.kind` (the `sport_event_request_
-- decision` precedent): `set` when a match round's draw is saved (every
-- member of a complete match whose match changed — "You play Bob in the
-- Spring Open"), `won` / `lost` at the round's completion (each member of a
-- decided match — "You beat Bob 3&2" / "Bob beat you 3&2"). The action URL
-- lands on the Matches tab of the round.
--
-- The re-ADD is the 205 / 210 shape: the full list verbatim + the one new
-- type, so the registry parity test's "latest re-declaration" is this
-- file. Same PR: `src/lib/notification-registry.ts` gains the entry (verify
-- fails otherwise). The senders are 23514-tolerant — before this file runs
-- they log "run migration 213" and skip; nothing throws.
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
    'sport_event_reminder',
    'sport_event_match'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 213 APPLIED | 66 | 1
SELECT '213 APPLIED' AS result,
       (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g')) AS types_expect_66,
       (pg_get_constraintdef(oid) LIKE '%sport_event_match%')::int AS carries_match_expect_1
  FROM pg_constraint WHERE conname = 'notifications_type_check';
