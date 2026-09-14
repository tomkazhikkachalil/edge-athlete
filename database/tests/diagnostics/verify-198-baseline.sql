-- ============================================================================
-- Verify migration 198 (triggers baseline) — the recorded trigger is live
-- ============================================================================
-- READ ONLY. Safe to run any time. Expected values are the Sep 14 2026
-- catalog's (database/provenance/dumps/2026-09-14-catalog.json); 198 is a
-- no-op on production, so the grid reads the same before and after. 199
-- drops the recorded trigger on purpose (a duplicate): after 199 the first
-- row reads '-' and the counts drop by one — verify-199-cleanup.sql is the
-- grid for that state.
-- Every row should read OK (before 199).
-- ============================================================================

SELECT 'group_posts: trigger_group_posts_updated_at' AS check_name, 'a724655f02194ad758c31ae94e4184bd' AS expected,
       COALESCE((SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
                  WHERE t.tgrelid = 'public.group_posts'::regclass AND t.tgname = 'trigger_group_posts_updated_at'), '-') AS actual,
       CASE WHEN (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
                   WHERE t.tgrelid = 'public.group_posts'::regclass AND t.tgname = 'trigger_group_posts_updated_at') = 'a724655f02194ad758c31ae94e4184bd'
            THEN 'OK' ELSE 'CHECK FAILED' END AS status

UNION ALL

SELECT 'group_posts: triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.group_posts'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'public non-internal triggers', '101', count(*)::text,
       CASE WHEN count(*) = 101 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal

ORDER BY 1;
