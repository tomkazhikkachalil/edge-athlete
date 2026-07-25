-- ============================================================================
-- Migration 037 — Restore the remaining broken group-round trigger functions
-- ============================================================================
-- Same root cause as 036: archive/old-migrations/fix-utility-functions-
-- schema.sql "hardened" utility functions but REWROTE two of their bodies
-- incorrectly. Full audit of every function that file touched found exactly
-- these two still broken (the rest are semantically identical to canon):
--
-- 1) update_group_post_timestamp() — canonical (004): set NEW.updated_at.
--    Archive version: UPDATE group_posts WHERE id = NEW.group_post_id — a
--    "touch parent" body. But the trigger is attached to group_posts ITSELF
--    (no group_post_id column → 42703 on every group_posts UPDATE) and to
--    golf_participant_scores (also no group_post_id column → 42703 on every
--    score-row UPDATE, i.e. every hole save after the first).
--
-- 2) calculate_golf_participant_totals() — canonical (004): aggregate
--    golf_hole_scores by golf_participant_id into total_score / to_par /
--    holes_completed + mark data_contributed. Archive version references
--    participant_id and total_strokes/total_putts — NONE of which exist in
--    those tables → 42703 on every hole-score insert. This is the trigger
--    that computes leaderboard totals; with it broken, entering ANY hole
--    score fails.
--
-- Like 035/036, these never surfaced because no shared round ever existed
-- (creation itself was blocked by the 035 recursion until tonight).
--
-- Bodies below are 004's canon, schema-qualified with SET search_path = ''
-- (keeping the hardening the archive file was actually trying to add).
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ⚠️ No deploy needed — takes effect immediately. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_group_post_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE OR REPLACE FUNCTION public.calculate_golf_participant_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_golf_participant_id UUID;
  v_total_score INTEGER;
  v_holes_completed INTEGER;
  v_estimated_par INTEGER;
  v_to_par INTEGER;
BEGIN
  -- Get golf_participant_id from NEW or OLD (for DELETE)
  IF TG_OP = 'DELETE' THEN
    v_golf_participant_id := OLD.golf_participant_id;
  ELSE
    v_golf_participant_id := NEW.golf_participant_id;
  END IF;

  -- Calculate totals from hole scores
  SELECT
    COALESCE(SUM(strokes), 0),
    COUNT(*)
  INTO v_total_score, v_holes_completed
  FROM public.golf_hole_scores
  WHERE golf_participant_id = v_golf_participant_id;

  -- Estimate par (4 per hole, can be refined later with actual course data)
  v_estimated_par := v_holes_completed * 4;

  -- Calculate to-par
  IF v_holes_completed > 0 THEN
    v_to_par := v_total_score - v_estimated_par;
  ELSE
    v_to_par := NULL;
  END IF;

  -- Update aggregated scores
  UPDATE public.golf_participant_scores
  SET
    total_score = v_total_score,
    to_par = v_to_par,
    holes_completed = v_holes_completed,
    updated_at = NOW()
  WHERE id = v_golf_participant_id;

  -- Mark participant as having contributed data
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
-- SELECT prosrc FROM pg_proc WHERE proname = 'update_group_post_timestamp';
--   → body sets NEW.updated_at (no reference to group_post_id)
-- SELECT prosrc FROM pg_proc WHERE proname = 'calculate_golf_participant_totals';
--   → references golf_participant_id and total_score (NOT participant_id /
--     total_strokes)
-- Functional: the diagnostic script passes 6/6; entering a hole score in the
-- app updates the participant's total.
