-- ============================================================
-- FIX: Calculate Par from Actual Holes Played
-- ============================================================
-- Purpose: Update golf_rounds to store actual par from recorded holes
-- Issue: Par was defaulting to 72 (18-hole standard) even for partial rounds
-- Solution: Calculate par dynamically from golf_holes records
-- ============================================================

-- Update the calculate_round_stats function to include par calculation
CREATE OR REPLACE FUNCTION calculate_round_stats(round_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_strokes INTEGER;
    total_putts_calc INTEGER;
    total_par INTEGER;
    fir_count INTEGER;
    fir_eligible INTEGER;
    gir_count INTEGER;
    total_holes INTEGER;
BEGIN
    -- Get basic stats from holes INCLUDING actual par
    SELECT
        COALESCE(SUM(strokes), 0),
        COALESCE(SUM(putts), 0),
        COALESCE(SUM(par), 0),  -- Calculate actual par from recorded holes
        COUNT(*) FILTER (WHERE fairway_hit = true),
        COUNT(*) FILTER (WHERE par > 3),
        COUNT(*) FILTER (WHERE green_in_regulation = true),
        COUNT(*)
    INTO total_strokes, total_putts_calc, total_par, fir_count, fir_eligible, gir_count, total_holes
    FROM golf_holes
    WHERE round_id = round_uuid;

    -- Update round with calculated stats
    UPDATE golf_rounds
    SET
        gross_score = CASE WHEN total_strokes > 0 THEN total_strokes ELSE gross_score END,
        total_putts = CASE WHEN total_putts_calc > 0 THEN total_putts_calc ELSE total_putts END,
        par = CASE WHEN total_par > 0 THEN total_par ELSE par END,  -- Set par from holes
        holes = CASE WHEN total_holes > 0 THEN total_holes ELSE holes END,  -- Set actual holes played
        fir_percentage = CASE WHEN fir_eligible > 0 THEN ROUND((fir_count::decimal / fir_eligible) * 100, 1) ELSE fir_percentage END,
        gir_percentage = CASE WHEN total_holes > 0 THEN ROUND((gir_count::decimal / total_holes) * 100, 1) ELSE gir_percentage END,
        is_complete = (total_holes >= holes),
        updated_at = now()
    WHERE id = round_uuid;
END;
$$ LANGUAGE 'plpgsql';

-- Recalculate stats for existing rounds to fix par values
DO $$
DECLARE
    round_record RECORD;
BEGIN
    FOR round_record IN SELECT id FROM golf_rounds
    LOOP
        PERFORM calculate_round_stats(round_record.id);
    END LOOP;

    RAISE NOTICE 'Updated par calculation for all existing golf rounds';
END $$;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Golf par calculation fixed!';
    RAISE NOTICE 'Par is now calculated from actual holes played';
    RAISE NOTICE 'Display will show "Through N holes" for partial rounds';
END $$;
