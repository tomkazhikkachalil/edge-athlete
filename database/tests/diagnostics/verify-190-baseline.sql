-- ============================================================================
-- Verify migration 190 (social core) — the live shape is still the recorded one
-- ============================================================================
-- READ ONLY. Safe to run any time, as often as you like. Nothing here modifies
-- the database.
--
-- The expected numbers are the 2026-09-14-live-dump.csv counts
-- (database/provenance/dumps/2026-09-14-live-dump.csv) — 190 is a NO-OP on production, so this grid reads
-- the same before and after it runs. A later migration that touches one of
-- these tables changes a number here on purpose; anything else, paste the
-- grid back.
--
-- Every row should read OK.
-- ============================================================================

SELECT 'follows: columns' AS check_name, '7' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'follows'

UNION ALL

SELECT 'follows: constraints', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.follows'::regclass

UNION ALL

SELECT 'follows: indexes', '7', count(*)::text,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'follows'

UNION ALL

SELECT 'follows: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'follows'

UNION ALL

SELECT 'follows: triggers', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.follows'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'follows: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.follows'::regclass

UNION ALL

SELECT 'posts: columns' AS check_name, '29' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 29 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts'

UNION ALL

SELECT 'posts: constraints', '11', count(*)::text,
       CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.posts'::regclass

UNION ALL

SELECT 'posts: indexes', '20', count(*)::text,
       CASE WHEN count(*) = 20 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'posts'

UNION ALL

SELECT 'posts: policies', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts'

UNION ALL

SELECT 'posts: triggers', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'posts: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.posts'::regclass

UNION ALL

SELECT 'post_media: columns' AS check_name, '12' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_media'

UNION ALL

SELECT 'post_media: constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.post_media'::regclass

UNION ALL

SELECT 'post_media: indexes', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'post_media'

UNION ALL

SELECT 'post_media: policies', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media'

UNION ALL

SELECT 'post_media: triggers', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_media'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_media: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.post_media'::regclass

UNION ALL

SELECT 'post_likes: columns' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_likes'

UNION ALL

SELECT 'post_likes: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.post_likes'::regclass

UNION ALL

SELECT 'post_likes: indexes', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'post_likes'

UNION ALL

SELECT 'post_likes: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_likes'

UNION ALL

SELECT 'post_likes: triggers', '2', count(*)::text, -- 199 dropped the duplicate count trigger (was 3)
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_likes'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_likes: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.post_likes'::regclass

UNION ALL

SELECT 'post_comments: columns' AS check_name, '15' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 15 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_comments'

UNION ALL

SELECT 'post_comments: constraints', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.post_comments'::regclass

UNION ALL

SELECT 'post_comments: indexes', '9', count(*)::text,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'post_comments'

UNION ALL

SELECT 'post_comments: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_comments'

UNION ALL

SELECT 'post_comments: triggers', '2', count(*)::text, -- 199 dropped the duplicate count trigger (was 3)
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_comments: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.post_comments'::regclass

UNION ALL

SELECT 'comment_likes: columns' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comment_likes'

UNION ALL

SELECT 'comment_likes: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.comment_likes'::regclass

UNION ALL

SELECT 'comment_likes: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'comment_likes'

UNION ALL

SELECT 'comment_likes: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_likes'

UNION ALL

SELECT 'comment_likes: triggers', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.comment_likes'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'comment_likes: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.comment_likes'::regclass

ORDER BY 1;
