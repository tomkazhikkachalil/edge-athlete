-- ============================================================================
-- Verify migration 210 (sport_event_reminder in the notifications type CHECK)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 210 the reminder row reads
-- CHECK FAILED; AFTER 210 every row reads OK. The migration ends in ONE
-- result row ("210 APPLIED | 65 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-210-sport-event-reminder.sql' AS expected, 'verify-210-sport-event-reminder.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'type check carries sport_event_reminder', 'true',
       (pg_get_constraintdef(oid) LIKE '%sport_event_reminder%')::text,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%sport_event_reminder%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'type check still carries the 205 five and the old ones', 'true',
       (pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%' AND pg_get_constraintdef(oid) LIKE '%follow_request%' AND pg_get_constraintdef(oid) LIKE '%site_form_submission%')::text,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%' AND pg_get_constraintdef(oid) LIKE '%follow_request%' AND pg_get_constraintdef(oid) LIKE '%site_form_submission%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'type check lists 65 types', '65',
       (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g'))::text,
       CASE WHEN (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g')) = 65 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

ORDER BY 1;
