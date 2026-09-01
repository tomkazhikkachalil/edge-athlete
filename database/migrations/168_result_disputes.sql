-- ============================================================================
-- 168: result disputes — workflow metadata + notification types 49 → 51
--      (phase 6 R4)
-- ============================================================================
-- contest_results.dispute_status has been column-room since 152
-- ('none'|'disputed'|'resolved', every row 'none'). This migration adds
-- the workflow metadata (who raised it, when, the note, who resolved)
-- and the two bell types. The workflow itself: raise/withdraw by a
-- manager of either participating org, resolve by the owning org — the
-- record holds both sides and shows unconfirmed until resolved
-- (masterplan §7: last-write-wins must not decide a season). Provenance
-- is untouched by dispute state.
--
-- ORDER-STRICT: run AFTER 167. Senders are best-effort — a 23514 on the
-- old CHECK only drops the bell, never the transition. Re-runnable.
--
-- Down-steps (documentation only): drop the five columns; re-ADD the
-- 163 49-type list (delete rows of the two new types first).

ALTER TABLE contest_results
  ADD COLUMN IF NOT EXISTS disputed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_note text
    CONSTRAINT contest_results_dispute_note_len CHECK (dispute_note IS NULL OR length(dispute_note) <= 500),
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

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
    'contest_dispute_raised','contest_dispute_resolved'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='contest_results' AND column_name='disputed_by')  AS disputed_by_col,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='contest_results' AND column_name='dispute_note') AS note_col,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='contest_results' AND column_name='resolved_at')  AS resolved_col,
  (SELECT pg_get_constraintdef(oid) LIKE '%contest_dispute_raised%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')          AS raised_type,
  (SELECT pg_get_constraintdef(oid) LIKE '%contest_dispute_resolved%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')          AS resolved_type,
  (SELECT pg_get_constraintdef(oid) LIKE '%org_registration_released%'
     FROM pg_constraint WHERE conname = 'notifications_type_check')          AS prior_types_kept;
