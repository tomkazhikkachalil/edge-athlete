-- ============================================================================
-- Verify migration 243 (the newsroom: org_site_news summary / cover / team or
-- division tag / notify + banner / recap source / draft / author; the audit's
-- news_published + news_notified)
-- ============================================================================
-- READ ONLY, runnable before 243 (the structural rows read CHECK FAILED) and
-- after (every row OK; INFO rows are counts to read, never failures). The
-- migration ends in ONE result row ("243 APPLIED | 10 | 6 | 5 | 1 | 243").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-243-newsroom.sql' AS expected, 'verify-243-newsroom.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'org_site_news newsroom columns', '10', count(*)::text,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_site_news'
   AND column_name IN ('summary', 'cover_path', 'team_id', 'division_id', 'notify_members', 'notified_at', 'banner_until', 'source_ref', 'draft', 'created_by')

UNION ALL
SELECT 'org_site_news newsroom CHECKs', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('org_site_news_summary_check', 'org_site_news_cover_path_check', 'org_site_news_one_tag_check',
    'org_site_news_notified_check', 'org_site_news_source_ref_check', 'org_site_news_draft_check')

UNION ALL
SELECT 'notify_members is NOT NULL DEFAULT false', 'NO|false', max(is_nullable) || '|' || max(column_default),
       CASE WHEN max(is_nullable) = 'NO' AND max(column_default) = 'false' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_site_news' AND column_name = 'notify_members'

UNION ALL
SELECT 'the three new foreign keys are SET NULL', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c
 WHERE c.conrelid = 'public.org_site_news'::regclass AND c.contype = 'f' AND c.confdeltype = 'n'
   AND (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) IN ('team_id', 'division_id', 'created_by')

UNION ALL
SELECT 'newsroom indexes', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('org_site_news_source_ref_uniq', 'idx_org_site_news_team',
    'idx_org_site_news_division', 'idx_org_site_news_notify_due', 'idx_org_site_news_created_by')

UNION ALL
SELECT 'the source_ref index is UNIQUE and partial', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'org_site_news_source_ref_uniq'
   AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%deleted_at IS NULL%'

UNION ALL
SELECT 'authority_audit admits news_published + news_notified (and keeps 241''s)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'authority_audit_action_check'
   AND pg_get_constraintdef(oid) LIKE '%news_published%' AND pg_get_constraintdef(oid) LIKE '%news_notified%'
   AND pg_get_constraintdef(oid) LIKE '%official_tag_removed%'

UNION ALL
SELECT 'org_site_news RLS still on (posture 156)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'org_site_news' AND c.relrowsecurity

UNION ALL
SELECT 'INFO posts', '-', count(*)::text, 'INFO' FROM public.org_site_news

UNION ALL
SELECT 'ledger head', '243', max(number)::text,
       CASE WHEN max(number) >= 243 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations;
