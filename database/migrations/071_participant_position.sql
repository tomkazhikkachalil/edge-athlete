-- Migration 071: group_post_participants.position — capture round creation order
--
-- WHY: player order differed on every surface (feed card sorted best-first,
-- the detail scorecard showed raw embed order — which PostgREST leaves
-- UNSPECIFIED and UPDATEs can physically shuffle — and the creation preview
-- showed true input order). Tom's rule: the order players were entered when
-- the round was created is THE order, everywhere.
--
-- The batch invitee INSERT gives every invitee an identical created_at
-- (NOW() = transaction timestamp), so creation order among invitees was
-- never captured at rest. This column captures it going forward; the app
-- orders by (position ASC NULLS LAST, created_at ASC, id ASC), so legacy
-- rows still come out creator-first (the creator's row is a separate,
-- strictly-earlier transaction) with a stable id tiebreak.
--
-- RUN BEFORE DEPLOYING the app change (ADD COLUMN before deploy — the new
-- GROUP_PARTICIPANTS select references the column and would 42703 without it).
--
-- Pre-flight (expect: column does not exist):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'group_post_participants' AND column_name = 'position';

ALTER TABLE group_post_participants
  ADD COLUMN IF NOT EXISTS position INTEGER;

COMMENT ON COLUMN group_post_participants.position IS
  'Creation input order (0-based). NULL for rounds created before migration 071 — readers fall back to created_at, id.';

-- Ordering reads are always scoped to one round.
CREATE INDEX IF NOT EXISTS idx_participants_position
  ON group_post_participants (group_post_id, position);

-- Verify (expect: 1 row, data_type integer):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'group_post_participants' AND column_name = 'position';
-- And existing rows untouched (expect: every position IS NULL):
--   SELECT COUNT(*) FILTER (WHERE position IS NOT NULL) AS populated FROM group_post_participants;
