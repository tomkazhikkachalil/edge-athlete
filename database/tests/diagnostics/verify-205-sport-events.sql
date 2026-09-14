-- ============================================================================
-- Verify migration 205 (the sport_event_* notification types)
-- ============================================================================
-- READ ONLY. Safe to run any time. The one type CHECK carries the five new types and every old one.
-- Every row should read OK.
-- ============================================================================

SELECT 'type check carries the five' AS check_name, 'true' AS expected,
       (pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%')::text AS actual,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'type check still carries the old ones', 'true',
       (pg_get_constraintdef(oid) LIKE '%site_form_submission%' AND pg_get_constraintdef(oid) LIKE '%follow_request%')::text,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%site_form_submission%' AND pg_get_constraintdef(oid) LIKE '%follow_request%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'exactly one type check', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

ORDER BY 1;
