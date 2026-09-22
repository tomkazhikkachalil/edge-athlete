-- ============================================================================
-- Verify migration 229 (follower counts by trigger; notifications.metadata
-- GIN — Round 3)
-- ============================================================================
-- READ ONLY. BEFORE 229 the column rows read CHECK FAILED (the reads go
-- through to_jsonb(row) -> 'col', never by name, so a missing column is a
-- row, not a 42703). AFTER 229 every row reads OK, and the drift rows stay
-- OK forever — they compare the column to the live edges, so a write path
-- that bypassed the trigger would show here first.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-229-follow-counts.sql' AS expected, 'verify-229-follow-counts.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'profiles has followers_count + following_count', '2',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('followers_count', 'following_count')),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('followers_count', 'following_count')) = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'both columns are NULLABLE (the row-type insert rule)', '2',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('followers_count', 'following_count') AND is_nullable = 'YES'),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('followers_count', 'following_count') AND is_nullable = 'YES') = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the trigger is on follows (insert, update, delete)', 'present',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'follows' AND t.tgname = 'follows_counts_sync' AND NOT t.tgisinternal) THEN 'present' ELSE 'absent' END,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'follows' AND t.tgname = 'follows_counts_sync' AND NOT t.tgisinternal) THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'followers_count matches the accepted edges on every profile', '0 drifted',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'followers_count') = 0 THEN 'absent'
            ELSE (SELECT count(*)::text || ' drifted' FROM public.profiles p
                   WHERE COALESCE((to_jsonb(p) ->> 'followers_count')::int, 0) <> (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id AND f.status = 'accepted')) END,
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'followers_count') > 0
             AND (SELECT count(*) FROM public.profiles p
                   WHERE COALESCE((to_jsonb(p) ->> 'followers_count')::int, 0) <> (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id AND f.status = 'accepted')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'following_count matches the accepted edges on every profile', '0 drifted',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'following_count') = 0 THEN 'absent'
            ELSE (SELECT count(*)::text || ' drifted' FROM public.profiles p
                   WHERE COALESCE((to_jsonb(p) ->> 'following_count')::int, 0) <> (SELECT count(*) FROM public.follows f WHERE f.follower_id = p.id AND f.status = 'accepted')) END,
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'following_count') > 0
             AND (SELECT count(*) FROM public.profiles p
                   WHERE COALESCE((to_jsonb(p) ->> 'following_count')::int, 0) <> (SELECT count(*) FROM public.follows f WHERE f.follower_id = p.id AND f.status = 'accepted')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'notifications.metadata has the GIN index', 'present',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_metadata_gin') THEN 'present' ELSE 'absent' END,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_metadata_gin') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the ledger records 229', '229',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text = '229' THEN 'OK' ELSE 'CHECK FAILED' END;
