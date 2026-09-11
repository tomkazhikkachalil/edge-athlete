-- ============================================================================
-- 187 — Site forms: contact + interest submissions (Site Builder program 2, D — Sep 11 2026)
--
-- Two fixed forms as site widgets (contact_form, interest_form). A visitor's
-- submission lands here; the org's owner and admins are notified
-- ('site_form_submission') and read it in the console's Inbox. Posture A:
-- RLS on, zero policies, REVOKE ALL — the service role is the only reader
-- and writer (the public POST route validates, rate-limits and inserts).
--
--   kind        'contact' | 'interest'
--   fields      jsonb — the validated fields (name, email, message; interest
--               adds phone? and an age GROUP — never a date of birth)
--   page_path   the public path the form sat on (for the inbox line)
--   read_at / archived_at — the inbox's two states; the daily cron purges
--               archived rows after 365 days and unarchived after 730
--
-- Re-runnable end to end. Down-steps (documentation only, never executed):
--   DROP TABLE IF EXISTS org_site_form_submissions;
--   re-ADD notifications_type_check with 179's list.
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_site_form_submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES org_sites(id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT org_site_form_submissions_kind_check CHECK (kind IN ('contact', 'interest')),
  fields      jsonb NOT NULL DEFAULT '{}',
  page_path   text,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  read_at     timestamptz,
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_org_site_form_submissions_site_created
  ON org_site_form_submissions (site_id, created_at DESC);

ALTER TABLE org_site_form_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_site_form_submissions FROM PUBLIC, anon, authenticated;

-- The notification type: the 179 list + 'site_form_submission' (re-ADD in full).
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
    'site_form_submission'
  ));

NOTIFY pgrst, 'reload schema';

-- Check grid (a SELECT, never a RAISE):
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'org_site_form_submissions') AS submissions_table,
  (SELECT pg_get_constraintdef(oid) LIKE '%site_form_submission%' FROM pg_constraint WHERE conname = 'notifications_type_check') AS notification_type_added;
