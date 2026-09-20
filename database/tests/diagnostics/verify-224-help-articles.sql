-- ============================================================================
-- Verify migration 224 (help_articles — Support & Reporting, Spec 3)
-- ============================================================================
-- READ ONLY. BEFORE 224 the rows read CHECK FAILED; AFTER 224 every row reads
-- OK. The migration ends in ONE result row ("224 APPLIED | 1 | 1 | 1 | 1").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-224-help-articles.sql' AS expected, 'verify-224-help-articles.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'help_articles table exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'help_articles'

UNION ALL

SELECT 'the four CHECKs (topic, slug shape, title length, body length)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.help_articles'::regclass AND contype = 'c'

UNION ALL

SELECT 'slug is UNIQUE', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'help_articles_slug_key' AND conrelid = 'public.help_articles'::regclass AND contype = 'u'

UNION ALL

SELECT 'the partial public index (published only)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_help_articles_public' AND indexdef LIKE '%WHERE published%'

UNION ALL

SELECT 'updated_at trigger (handle_updated_at)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'help_articles_updated_at' AND tgrelid = 'public.help_articles'::regclass

UNION ALL

SELECT 'posture A: RLS on, zero policies', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'help_articles' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'help_articles')

UNION ALL

SELECT 'posture A: anon + authenticated hold no privilege', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'help_articles' AND grantee IN ('anon', 'authenticated');
