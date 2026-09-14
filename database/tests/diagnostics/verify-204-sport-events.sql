-- ============================================================================
-- Verify migration 204 (the scorecard status on golf_participant_scores)
-- ============================================================================
-- READ ONLY. Safe to run any time. The three columns and two constraints exist; every card that is not an event card stays in_progress (the 'every existing card' row will stop reading OK once real event cards are submitted — a later PR narrows it).
-- Every row should read OK.
-- ============================================================================

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
