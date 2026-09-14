-- ============================================================================
-- Verify migration 206 (reserved_handles gains sports)
-- ============================================================================
-- READ ONLY. Safe to run any time. The root segments sports, events and event are reserved.
-- Every row should read OK.
-- ============================================================================

SELECT 'sports reserved' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM reserved_handles WHERE handle = 'sports'

UNION ALL

SELECT 'events + event already reserved', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM reserved_handles WHERE handle IN ('events', 'event')

ORDER BY 1;
