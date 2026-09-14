-- ============================================================================
-- 204: golf_participant_scores.status / submitted_at / finalized_by — a card
--      is in progress, submitted, or final (Events program, phase 1)
-- ============================================================================
-- Tom's spec: every participant enters their own score and SUBMITS their
-- card; the organizer resolves discrepancies and marks any card FINAL;
-- attestation (a playing partner confirms your card) is v2 — so the status
-- field is shaped so attestation adds no migration.
--
-- Why a new column and not `scores_confirmed`: that boolean is written ONCE
-- at row creation as "the participant entered it themselves"
-- (api/golf/scorecards/[id]/scores) — it records who typed first, not "I
-- stand by this card"; its PATCH has no caller. It stays what it is (the
-- "entered by organizer" chip reads it). The event's own vocabulary:
--   in_progress  holes still landing (every existing row — none belongs to
--                an event)
--   submitted    the owner submitted the card (submitted_at); a group-mate
--                may no longer write it; the owner may reopen by writing
--   final        the organizer marked it (finalized_by); only organizers
--                write it
-- Written by the sport-events routes on the service client; the table's
-- four policies are untouched. Fast default, no rewrite, no red window.
-- ============================================================================

ALTER TABLE golf_participant_scores
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_status_check' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE golf_participant_scores ADD CONSTRAINT golf_participant_scores_status_check CHECK (status IN ('in_progress', 'submitted', 'final'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_submitted_check' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE golf_participant_scores ADD CONSTRAINT golf_participant_scores_submitted_check CHECK (status = 'in_progress' OR submitted_at IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN golf_participant_scores.status IS 'in_progress | submitted (the owner, submitted_at) | final (an organizer, finalized_by). Event rounds only; every other card stays in_progress. Written by src/app/api/sport-events routes on the service client.';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'three columns' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_participant_scores'
   AND column_name IN ('status', 'submitted_at', 'finalized_by')

UNION ALL

SELECT 'two constraints', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.golf_participant_scores'::regclass
   AND conname IN ('golf_participant_scores_status_check', 'golf_participant_scores_submitted_check')

UNION ALL

SELECT 'every existing card in_progress', 'true', (count(*) = count(*) FILTER (WHERE status = 'in_progress'))::text,
       CASE WHEN count(*) = count(*) FILTER (WHERE status = 'in_progress') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM golf_participant_scores

UNION ALL

SELECT 'policies untouched', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'

ORDER BY 1;
