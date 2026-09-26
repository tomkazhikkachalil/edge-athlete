-- ============================================================================
-- Verify migration 240 (authority: the audit table, org/event ticket targets,
-- the support bell, the site hold, the recovery claim, news soft delete)
-- ============================================================================
-- READ ONLY, runnable before 240 (the structural rows read CHECK FAILED) and
-- after (every row OK). The migration ends in ONE result row
-- ("240 APPLIED | 1 | 1 | 1 | 1 | 0 | 240").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-240-authority.sql' AS expected, 'verify-240-authority.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'authority_audit exists with RLS on and zero policies', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'authority_audit' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'authority_audit')

UNION ALL
SELECT 'authority_audit has NO foreign keys (the append-only trigger vs SET NULL)', '0', count(*)::text,
       CASE WHEN count(*) = 0 AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'authority_audit') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE contype = 'f' AND conrelid = to_regclass('public.authority_audit')

UNION ALL
SELECT 'the append-only trigger (forbid_mutation) is on authority_audit', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgname = 'authority_audit_immutable' AND NOT t.tgisinternal AND p.proname = 'forbid_mutation'

UNION ALL
SELECT 'authority_audit indexes (subject, target, actor, ticket)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
       ('idx_authority_audit_subject', 'idx_authority_audit_target', 'idx_authority_audit_actor', 'idx_authority_audit_ticket')

UNION ALL
SELECT 'ticket CHECKs admit org / sport_event targets + subtypes and access_restored', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint
 WHERE (conname = 'tickets_target_type_check' AND pg_get_constraintdef(oid) LIKE '%sport_event%')
    OR (conname = 'tickets_subtype_check' AND pg_get_constraintdef(oid) LIKE '%sport_event%')
    OR (conname = 'tickets_resolution_code_check' AND pg_get_constraintdef(oid) LIKE '%access_restored%')

UNION ALL
SELECT 'the authority_notice bell type', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%authority_notice%'

UNION ALL
SELECT 'org_sites: the hold columns and org_sites_held_shape', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'org_sites_held_shape'
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_sites' AND column_name = 'held_ticket_id')

UNION ALL
SELECT 'org_claim_invites: purpose + recovery shape', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('org_claim_invites_purpose_check', 'org_claim_invites_recovery_shape')

UNION ALL
SELECT 'org_site_news: deleted_at + deleted_by', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_site_news' AND column_name IN ('deleted_at', 'deleted_by')

UNION ALL
SELECT 'no site is held AND live', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM org_sites s WHERE (to_jsonb(s) ->> 'held_at') IS NOT NULL AND s.published_at IS NOT NULL

UNION ALL
SELECT 'every foreign key has a leading index (239 still holds)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
 WHERE c.contype = 'f' AND ns.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                     AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[]);
