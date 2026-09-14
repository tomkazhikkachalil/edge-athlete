-- ============================================================================
-- Verify migration 192 (golf_rounds conditions) — the live shape is recorded
-- ============================================================================
-- READ ONLY. Safe to run any time. Expected values are the Sep 14 2026 dump's
-- (database/provenance/dumps/2026-09-14-live-dump.csv); 192 is a no-op on
-- production, so the grid reads the same before and after. Every row OK.
-- ============================================================================

SELECT 'golf_rounds: the six columns' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'golf_rounds'
   AND column_name IN ('weather', 'temperature', 'wind', 'course_rating', 'slope_rating', 'round_type')

UNION ALL

SELECT 'golf_rounds: course_rating precision', 'numeric(4,1)',
       format_type(atttypid, atttypmod),
       CASE WHEN format_type(atttypid, atttypmod) = 'numeric(4,1)' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_attribute WHERE attrelid = 'public.golf_rounds'::regclass AND attname = 'course_rating'

UNION ALL

SELECT 'golf_rounds: round_type CHECK', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.golf_rounds'::regclass AND conname = 'golf_rounds_round_type_check'

UNION ALL

SELECT 'golf_rounds: holes CHECK gone', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.golf_rounds'::regclass AND conname = 'golf_rounds_holes_check'

UNION ALL

SELECT 'golf_rounds: columns', '24', count(*)::text,
       CASE WHEN count(*) = 24 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_rounds'

ORDER BY 1;
