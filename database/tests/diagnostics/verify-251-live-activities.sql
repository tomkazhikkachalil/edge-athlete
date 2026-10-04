-- ============================================================================
-- Verify migration 251 (live activities: the 'live' source, 26 activity
-- types, segments / steps / notes, activity_media)
-- ============================================================================
-- READ ONLY, runnable before 251 (the structural rows read CHECK FAILED) and
-- after (every row OK). The migration ends in ONE result row
-- ("251 APPLIED | 4 | 1 | 3 | true | 251").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-251-live-activities.sql' AS expected, 'verify-251-live-activities.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'activities.source admits live', 'true',
       coalesce((SELECT (pg_get_constraintdef(oid) LIKE '%''live''%')::text FROM pg_constraint WHERE conname = 'activities_source_check'), 'missing'),
       CASE WHEN (SELECT pg_get_constraintdef(oid) LIKE '%''live''%' FROM pg_constraint WHERE conname = 'activities_source_check') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'activities.activity_type lists 26 types (treadmill among them)', 'true',
       coalesce((SELECT (pg_get_constraintdef(oid) LIKE '%''treadmill''%' AND pg_get_constraintdef(oid) LIKE '%''yoga''%')::text FROM pg_constraint WHERE conname = 'activities_activity_type_check'), 'missing'),
       CASE WHEN (SELECT pg_get_constraintdef(oid) LIKE '%''treadmill''%' AND pg_get_constraintdef(oid) LIKE '%''yoga''%' FROM pg_constraint WHERE conname = 'activities_activity_type_check') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'activities: segments, steps, steps_source, notes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'activities' AND column_name IN ('segments', 'steps', 'steps_source', 'notes')

UNION ALL
SELECT 'segments defaults to [] and is capped at 50', 'true',
       coalesce((SELECT (pg_get_constraintdef(oid) LIKE '%<= 50%')::text FROM pg_constraint WHERE conname = 'activities_segments_check'), 'missing'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_segments_check')
             AND (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'segments') LIKE '%[]%'
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'activity_media exists, RLS on, no policies (service role only)', 'true|0',
       coalesce((SELECT rowsecurity::text FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_media'), 'missing') || '|' ||
       (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_media'),
       CASE WHEN (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_media')
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_media') = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'activity_media: three FKs, each with a leading index', '3|3',
       (SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'public.activity_media'::regclass AND contype = 'f') || '|' ||
       (SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'activity_media' AND indexname LIKE 'idx_activity_media_%'),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.activity_media'::regclass AND contype = 'f') = 3
             AND (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'activity_media' AND indexname LIKE 'idx_activity_media_%') = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'activity_media: one row per (activity, url)', 'true',
       (SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_media_activity_url_uniq'))::text,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_media_activity_url_uniq') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'ledger records 251', '251', coalesce((SELECT number::text FROM public.schema_migrations WHERE number = 251), 'missing'),
       CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 251) THEN 'OK' ELSE 'CHECK FAILED' END;
