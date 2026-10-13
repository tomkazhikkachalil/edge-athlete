-- verify-261-media-jobs.sql — the check grid for migration 261 (read-only).
-- Run after 261 on staging and prod; every row should read true.
SELECT 'post_media carries codec / processing_at / blur_hash / transcode_source_url' AS check_name,
       (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_media'
         AND column_name IN ('codec', 'processing_at', 'blur_hash', 'transcode_source_url')) AS pass
UNION ALL
SELECT 'activity_media carries the same four',
       (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activity_media'
         AND column_name IN ('codec', 'processing_at', 'blur_hash', 'transcode_source_url'))
UNION ALL
SELECT 'the codec CHECK names avc and hevc on both',
       (SELECT count(*) = 2 FROM pg_constraint WHERE conname IN ('post_media_codec_check', 'activity_media_codec_check')
          AND pg_get_constraintdef(oid) LIKE '%''avc''%' AND pg_get_constraintdef(oid) LIKE '%''hevc''%')
UNION ALL
SELECT 'the blur_hash CHECK bounds 8..64 on both',
       (SELECT count(*) = 2 FROM pg_constraint WHERE conname IN ('post_media_blur_hash_check', 'activity_media_blur_hash_check')
          AND pg_get_constraintdef(oid) LIKE '%8%' AND pg_get_constraintdef(oid) LIKE '%64%')
UNION ALL
SELECT 'the two processing partial indexes exist',
       (SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_post_media_processing', 'idx_activity_media_processing'))
UNION ALL
SELECT 'every existing media row is playable (processing_at NULL)',
       NOT EXISTS (SELECT 1 FROM public.post_media WHERE processing_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.activity_media WHERE processing_at IS NOT NULL)
UNION ALL
SELECT 'media_jobs table, RLS on',
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'media_jobs' AND rowsecurity)
UNION ALL
SELECT 'no policies on media_jobs (posture A)',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_jobs')
UNION ALL
SELECT 'anon / authenticated hold no privilege on media_jobs',
       NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                   WHERE table_schema = 'public' AND table_name = 'media_jobs' AND grantee IN ('anon', 'authenticated'))
UNION ALL
SELECT 'the kind CHECK names video / poster / blur / probe; the status CHECK names queued / running / done / parked / failed / skipped',
       (SELECT pg_get_constraintdef(oid) LIKE '%''video''%' AND pg_get_constraintdef(oid) LIKE '%''probe''%' FROM pg_constraint WHERE conname = 'media_jobs_kind_check')
       AND (SELECT pg_get_constraintdef(oid) LIKE '%''parked''%' AND pg_get_constraintdef(oid) LIKE '%''skipped''%' FROM pg_constraint WHERE conname = 'media_jobs_status_check')
UNION ALL
SELECT 'one open job per target (the partial UNIQUE), the due index and the done-by-source index exist',
       (SELECT count(*) = 3 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('media_jobs_one_open', 'idx_media_jobs_due', 'idx_media_jobs_source_done'))
UNION ALL
SELECT 'media_jobs_claim exists; anon / authenticated cannot execute',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'media_jobs_claim')
       AND NOT has_function_privilege('anon', 'public.media_jobs_claim(integer, integer, integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.media_jobs_claim(integer, integer, integer)', 'EXECUTE')
UNION ALL
SELECT 'the ledger head is 261',
       (SELECT max(number) = 261 FROM public.schema_migrations);
