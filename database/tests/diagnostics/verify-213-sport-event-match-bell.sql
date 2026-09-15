-- ============================================================================
-- Verify migration 213 (sport_event_match in the notifications type CHECK)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 213 the match row reads CHECK
-- FAILED; AFTER 213 every row reads OK. The migration ends in ONE result
-- row ("213 APPLIED | 66 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-213-sport-event-match-bell.sql' AS expected, 'verify-213-sport-event-match-bell.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'type check carries sport_event_match', 'true',
       (pg_get_constraintdef(oid) LIKE '%sport_event_match%')::text,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%sport_event_match%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'type check still carries the 210 reminder, the 205 five and the old ones', 'true',
       (pg_get_constraintdef(oid) LIKE '%sport_event_reminder%' AND pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%' AND pg_get_constraintdef(oid) LIKE '%follow_request%' AND pg_get_constraintdef(oid) LIKE '%site_form_submission%')::text,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%sport_event_reminder%' AND pg_get_constraintdef(oid) LIKE '%sport_event_invite%' AND pg_get_constraintdef(oid) LIKE '%sport_event_results%' AND pg_get_constraintdef(oid) LIKE '%follow_request%' AND pg_get_constraintdef(oid) LIKE '%site_form_submission%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

UNION ALL

SELECT 'type check lists 66 types', '66',
       (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g'))::text,
       CASE WHEN (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g')) = 66 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'

ORDER BY 1;
