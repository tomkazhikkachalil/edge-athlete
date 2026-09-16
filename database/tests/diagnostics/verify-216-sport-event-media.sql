-- ============================================================================
-- Verify migration 216 (sport_event_media — Events program, phase 4)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 216 the table rows read CHECK
-- FAILED (the table is read through the catalogs, never by name in a
-- FROM — never an error); AFTER 216 every row reads OK. The migration ends
-- in ONE result row ("216 APPLIED | 1 | 3"); the first row here names THIS
-- file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-216-sport-event-media.sql' AS expected, 'verify-216-sport-event-media.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'sport_event_media: table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sport_event_media'

UNION ALL

SELECT 'sport_event_media: rls on', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'sport_event_media' AND c.relrowsecurity

UNION ALL

SELECT 'sport_event_media: zero policies', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_event_media'

UNION ALL

SELECT 'sport_event_media: no grant to anon / authenticated', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'sport_event_media' AND grantee IN ('anon', 'authenticated')

UNION ALL

SELECT 'sport_event_media: the twelve columns', '12', count(*)::text,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_media'
   AND column_name IN ('id', 'sport_event_id', 'sport_event_round_id', 'uploaded_by', 'created_by_user_id', 'media_url', 'media_type', 'thumbnail_url', 'duration_seconds', 'caption', 'mirrored_at', 'created_at')

UNION ALL

SELECT 'sport_event_media: constraints (pk + url, type, duration, caption CHECKs)', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_media' AND c.contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_media: the four FKs (event + uploader CASCADE; round + author SET NULL)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_media' AND c.contype = 'f'

UNION ALL

SELECT 'sport_event_media: the type CHECK carries image | video', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_media_type_check'
   AND pg_get_constraintdef(oid) LIKE '%''image''%' AND pg_get_constraintdef(oid) LIKE '%''video''%'

UNION ALL

SELECT 'sport_event_media: the three indexes', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sport_event_media' AND indexname IN ('idx_sport_event_media_event', 'idx_sport_event_media_round', 'idx_sport_event_media_uploader')

ORDER BY 1;
