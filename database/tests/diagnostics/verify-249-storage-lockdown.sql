-- ============================================================================
-- Verify migration 249 (storage lockdown: no storage.objects policies, the
-- uploads bucket's limits, athlete_equipment's wrapped auth.uid(), posts out
-- of realtime, the cron-history-prune job)
-- ============================================================================
-- READ ONLY, runnable before 249 (the structural rows read CHECK FAILED) and
-- after (every row OK; the job row reads OK on production and NOT HERE on
-- staging, which runs no pg_cron jobs by decision). The migration ends in ONE
-- result row ("249 APPLIED | 0 | 52428800 | 7 | 3 | 0 | 1 | 249").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-249-storage-lockdown.sql' AS expected, 'verify-249-storage-lockdown.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'storage.objects has no policies', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'

UNION ALL
SELECT 'the three avatar write-anything policies are gone', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname IN ('User Delete', 'User Update', 'User Upload')

UNION ALL
SELECT 'uploads bucket: private, 50 MB, 7 types', 'false|52428800|7',
       (SELECT public::text || '|' || coalesce(file_size_limit::text, 'null') || '|' || coalesce(array_length(allowed_mime_types, 1), 0)::text
          FROM storage.buckets WHERE id = 'uploads'),
       CASE WHEN (SELECT NOT public AND file_size_limit = 52428800 AND array_length(allowed_mime_types, 1) = 7
                    FROM storage.buckets WHERE id = 'uploads') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'uploads bucket admits video/quicktime (the phone''s MOV)', 'true',
       (SELECT ('video/quicktime' = ANY(allowed_mime_types))::text FROM storage.buckets WHERE id = 'uploads'),
       CASE WHEN (SELECT 'video/quicktime' = ANY(allowed_mime_types) FROM storage.buckets WHERE id = 'uploads') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'avatars bucket unchanged (public, 5 MB)', 'true|5242880',
       (SELECT public::text || '|' || file_size_limit::text FROM storage.buckets WHERE id = 'avatars'),
       CASE WHEN (SELECT public AND file_size_limit = 5242880 FROM storage.buckets WHERE id = 'avatars') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'athlete_equipment: three policies, all (select auth.uid())', '3|3',
       (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment'
         AND policyname IN ('equipment_delete_policy', 'equipment_insert_policy', 'equipment_update_policy')) || '|' ||
       (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment'
         AND policyname IN ('equipment_delete_policy', 'equipment_insert_policy', 'equipment_update_policy')
         AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%( SELECT auth.uid() AS uid)%'),
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment'
                   AND policyname IN ('equipment_delete_policy', 'equipment_insert_policy', 'equipment_update_policy')
                   AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%( SELECT auth.uid() AS uid)%') = 3
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'no bare auth.uid() left in any public policy', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '[^(]auth\.uid\(\)'
   AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'SELECT auth\.uid\(\)'

UNION ALL
SELECT 'posts is out of supabase_realtime', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'posts'

UNION ALL
SELECT 'the live tables stay in realtime', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
   AND tablename IN ('golf_participant_scores', 'group_posts', 'messages', 'notifications')

UNION ALL
SELECT 'cron-history-prune job (production only)', '1 on prod',
       CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
            THEN (SELECT count(*)::text FROM cron.job WHERE jobname = 'cron-history-prune') ELSE 'no pg_cron' END,
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN 'NOT HERE'
            WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'urgent-emails' AND active) THEN 'NOT HERE'
            WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-history-prune' AND active) THEN 'OK'
            ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'cron run history is bounded (≤ 7 days + today)', '0 older than 8 days',
       CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
            THEN (SELECT count(*)::text FROM cron.job_run_details WHERE end_time < now() - interval '8 days') ELSE 'no pg_cron' END,
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN 'NOT HERE'
            WHEN (SELECT count(*) FROM cron.job_run_details WHERE end_time < now() - interval '8 days') = 0 THEN 'OK'
            ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'ledger head', '249', max(number)::text,
       CASE WHEN max(number) = 249 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations;
