-- ============================================================================
-- Migration 039 — Real pars for group rounds + golf_rounds mirror linkage
-- ============================================================================
-- Three related changes enabling solo live rounds + honest to-par everywhere:
--
-- 1) golf_scorecard_data.hole_data — per-hole course data ([{hole,par,yardage}])
--    for group rounds. Until now group rounds stored NO per-hole par: the
--    score-entry modal showed every hole as "Par 4" and the totals trigger
--    estimated par as holes_completed * 4 (fiction on any non-par-72 course).
--    The create modal already collects this (course search / manual entry) —
--    the server just discarded it.
--
-- 2) golf_rounds.group_post_id — mirror linkage. When a group round COMPLETES,
--    the app writes a proper golf_rounds (+ golf_holes) row per player, so
--    group/solo-live rounds feed trends, handicap, the rounds pages, and
--    stats exactly like batch-entered solo rounds. Partial unique index makes
--    the mirror idempotent per (round, player).
--
-- 3) calculate_golf_participant_totals v3 — to_par now uses REAL pars from
--    hole_data (summed over PLAYED holes only), falling back to holes*4 when
--    hole_data is absent (legacy rounds).
--
-- ⚠️ RUN BEFORE DEPLOYING the code (new columns are in SELECTs → 42703
--    otherwise). Inert until the code ships. Idempotent.
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

ALTER TABLE golf_scorecard_data ADD COLUMN IF NOT EXISTS hole_data JSONB;
COMMENT ON COLUMN golf_scorecard_data.hole_data IS
  'Per-hole course data: [{"hole":1,"par":4,"yardage":390}, …]. Source of real pars for group rounds.';

ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS group_post_id UUID
  REFERENCES group_posts(id) ON DELETE SET NULL;
COMMENT ON COLUMN golf_rounds.group_post_id IS
  'Set on rounds mirrored from a completed group round (one per participant). NULL for batch-entered solo rounds.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_golf_rounds_group_mirror
  ON golf_rounds(group_post_id, profile_id) WHERE group_post_id IS NOT NULL;

-- Totals trigger v3: real-par to_par (played holes only), holes*4 fallback
CREATE OR REPLACE FUNCTION public.calculate_golf_participant_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_golf_participant_id UUID;
  v_total_score INTEGER;
  v_holes_completed INTEGER;
  v_played_par INTEGER;
  v_to_par INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_golf_participant_id := OLD.golf_participant_id;
  ELSE
    v_golf_participant_id := NEW.golf_participant_id;
  END IF;

  SELECT
    COALESCE(SUM(strokes), 0),
    COUNT(*)
  INTO v_total_score, v_holes_completed
  FROM public.golf_hole_scores
  WHERE golf_participant_id = v_golf_participant_id;

  -- Real par for the PLAYED holes, from the round's hole_data; NULL when the
  -- round has no hole_data (legacy) → fall back to the old holes*4 estimate.
  SELECT SUM((elem->>'par')::int)
  INTO v_played_par
  FROM public.golf_participant_scores gps
  JOIN public.group_post_participants gpp ON gpp.id = gps.participant_id
  JOIN public.golf_scorecard_data gsd ON gsd.group_post_id = gpp.group_post_id
  CROSS JOIN LATERAL jsonb_array_elements(gsd.hole_data) elem
  WHERE gps.id = v_golf_participant_id
    AND gsd.hole_data IS NOT NULL
    AND (elem->>'hole')::int IN (
      SELECT hole_number FROM public.golf_hole_scores
      WHERE golf_participant_id = v_golf_participant_id
    );

  IF v_holes_completed > 0 THEN
    v_to_par := v_total_score - COALESCE(v_played_par, v_holes_completed * 4);
  ELSE
    v_to_par := NULL;
  END IF;

  UPDATE public.golf_participant_scores
  SET
    total_score = v_total_score,
    to_par = v_to_par,
    holes_completed = v_holes_completed,
    updated_at = NOW()
  WHERE id = v_golf_participant_id;

  UPDATE public.group_post_participants
  SET
    data_contributed = (v_holes_completed > 0),
    last_contribution = CASE WHEN v_holes_completed > 0 THEN NOW() ELSE last_contribution END,
    updated_at = NOW()
  WHERE id = (
    SELECT participant_id FROM public.golf_participant_scores WHERE id = v_golf_participant_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'golf_scorecard_data' AND column_name = 'hole_data';  → 1 row
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'golf_rounds' AND column_name = 'group_post_id';     → 1 row
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_golf_rounds_group_mirror'; → 1 row
-- SELECT prosrc FROM pg_proc WHERE proname = 'calculate_golf_participant_totals';
--   → contains 'hole_data' (v3)
