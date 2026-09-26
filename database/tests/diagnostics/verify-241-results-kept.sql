-- ============================================================================
-- Verify migration 241 (results are never lost: the profile hide on posts and
-- golf rounds, the result audit actions, the result_corrected resolution)
-- ============================================================================
-- READ ONLY, runnable before 241 (the structural rows read CHECK FAILED) and
-- after (every row OK). The migration ends in ONE result row
-- ("241 APPLIED | 1 | 2 | 1 | 1 | 241").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-241-results-kept.sql' AS expected, 'verify-241-results-kept.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'posts_status_check admits profile_hidden (and keeps moderation''s hidden)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'posts_status_check' AND pg_get_constraintdef(oid) LIKE '%profile_hidden%' AND pg_get_constraintdef(oid) LIKE '%''hidden''%'

UNION ALL
SELECT 'profile_hidden_at on posts and golf_rounds', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'profile_hidden_at' AND table_name IN ('posts', 'golf_rounds')

UNION ALL
SELECT 'the hidden-rounds partial index', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_rounds_profile_hidden'

UNION ALL
SELECT 'authority_audit admits the five result actions', '5', (
         SELECT count(*) FROM unnest(ARRAY['result_hidden', 'result_unhidden', 'result_reassigned', 'result_corrected', 'official_tag_removed']) a
          WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_audit_action_check' AND pg_get_constraintdef(oid) LIKE '%''' || a || '''%'))::text,
       CASE WHEN (SELECT count(*) FROM unnest(ARRAY['result_hidden', 'result_unhidden', 'result_reassigned', 'result_corrected', 'official_tag_removed']) a
          WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_audit_action_check' AND pg_get_constraintdef(oid) LIKE '%''' || a || '''%')) = 5 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'authority_audit keeps 240''s actions (host_transferred still admitted)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'authority_audit_action_check' AND pg_get_constraintdef(oid) LIKE '%host_transferred%'

UNION ALL
SELECT 'tickets resolution codes admit result_corrected and keep access_restored', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'tickets_resolution_code_check' AND pg_get_constraintdef(oid) LIKE '%result_corrected%' AND pg_get_constraintdef(oid) LIKE '%access_restored%'

UNION ALL
SELECT 'ledger head', '241', (SELECT max(number) FROM public.schema_migrations)::text,
       CASE WHEN (SELECT max(number) FROM public.schema_migrations) = 241 THEN 'OK' ELSE 'CHECK FAILED' END;
