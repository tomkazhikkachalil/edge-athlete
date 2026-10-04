-- ============================================================================
-- Verify migration 250 (the uploads bucket admits application/gzip — the
-- activity stream — beside the seven image / video types 249 pinned)
-- ============================================================================
-- READ ONLY, runnable before 250 (the gzip row reads CHECK FAILED) and after
-- (every row OK). Supersedes 249's "7 types" row: the count is 8 now. The
-- migration ends in ONE result row ("250 APPLIED | true | 8 | 52428800 | 250").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-250-uploads-gzip.sql' AS expected, 'verify-250-uploads-gzip.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'uploads bucket admits application/gzip (the activity stream)', 'true',
       (SELECT ('application/gzip' = ANY(allowed_mime_types))::text FROM storage.buckets WHERE id = 'uploads'),
       CASE WHEN (SELECT 'application/gzip' = ANY(allowed_mime_types) FROM storage.buckets WHERE id = 'uploads') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'uploads bucket: private, 50 MB, 8 types', 'false|52428800|8',
       (SELECT public::text || '|' || coalesce(file_size_limit::text, 'null') || '|' || coalesce(array_length(allowed_mime_types, 1), 0)::text
          FROM storage.buckets WHERE id = 'uploads'),
       CASE WHEN (SELECT NOT public AND file_size_limit = 52428800 AND array_length(allowed_mime_types, 1) = 8
                    FROM storage.buckets WHERE id = 'uploads') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'the seven media types 249 pinned are still there', '7',
       (SELECT count(*)::text FROM unnest((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'uploads')) t
         WHERE t IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')),
       CASE WHEN (SELECT count(*) FROM unnest((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'uploads')) t
                   WHERE t IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')) = 7
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'ledger records 250', '250', coalesce((SELECT number::text FROM public.schema_migrations WHERE number = 250), 'missing'),
       CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 250) THEN 'OK' ELSE 'CHECK FAILED' END;
