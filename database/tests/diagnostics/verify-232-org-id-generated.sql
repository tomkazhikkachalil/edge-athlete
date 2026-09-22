-- ============================================================================
-- Verify migration 232 (`org_id` generated on the 15 pair tables — Round 5 B)
-- ============================================================================
-- READ ONLY. Catalog reads only, so it is safe BEFORE 232 (every row reads
-- CHECK FAILED with a 0 count) and AFTER (every row OK). The "no mismatch"
-- row is a tautology for a generated column — it is here so the twin keeps
-- meaning after step C makes org_id a real column mirrored the other way.
-- ============================================================================

WITH pair_tables AS (
  SELECT unnest(ARRAY['athlete_claim_invites','competitions','divisions','events','memberships','org_claim_invites','org_sites','org_staff_audit','org_staff_invites','registration_windows','registrations','seasons','sport_events','teams','venues']) AS t
),
cols AS (
  SELECT table_name, is_generated, generation_expression
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'org_id'
),
fks AS (
  SELECT conrelid::regclass::text AS t
    FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_org\_id\_fkey' AND confrelid = 'public.organizations'::regclass
),
idx AS (
  SELECT tablename FROM pg_indexes WHERE schemaname = 'public' AND indexdef ~ '\(org_id[,)]'
)

SELECT '0 file' AS check_name, 'verify-232-org-id-generated.sql' AS expected, 'verify-232-org-id-generated.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'org_id on every pair table', '15 tables',
       (SELECT count(*)::text || ' tables' FROM pair_tables p JOIN cols c ON c.table_name = p.t),
       CASE WHEN (SELECT count(*) FROM pair_tables p JOIN cols c ON c.table_name = p.t) = 15 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every org_id is GENERATED from COALESCE(league_id, club_id)', '15 generated',
       (SELECT count(*)::text || ' generated' FROM cols WHERE is_generated = 'ALWAYS' AND generation_expression ~* 'COALESCE\(league_id, club_id\)'),
       CASE WHEN (SELECT count(*) FROM cols WHERE is_generated = 'ALWAYS' AND generation_expression ~* 'COALESCE\(league_id, club_id\)') = 15 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'league_clubs has NO org_id (an affiliation, step D)', 'absent',
       CASE WHEN EXISTS (SELECT 1 FROM cols WHERE table_name = 'league_clubs') THEN 'present' ELSE 'absent' END,
       CASE WHEN EXISTS (SELECT 1 FROM cols WHERE table_name = 'league_clubs') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'FK → organizations on 14 (the audit trail has none)', '14 FKs, audit without',
       (SELECT count(*)::text FROM fks) || ' FKs, audit ' || CASE WHEN EXISTS (SELECT 1 FROM fks WHERE t = 'org_staff_audit') THEN 'WITH' ELSE 'without' END,
       CASE WHEN (SELECT count(*) FROM fks) = 14 AND NOT EXISTS (SELECT 1 FROM fks WHERE t = 'org_staff_audit') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'an index on org_id per table', '15 indexed',
       (SELECT count(DISTINCT p.t)::text || ' indexed' FROM pair_tables p JOIN idx i ON i.tablename = p.t),
       CASE WHEN (SELECT count(DISTINCT p.t) FROM pair_tables p JOIN idx i ON i.tablename = p.t) = 15 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no mismatch (teams · memberships · org_sites · seasons)', '0',
       ((SELECT count(*) FROM public.teams t WHERE t.org_id IS DISTINCT FROM COALESCE(t.league_id, t.club_id))
        + (SELECT count(*) FROM public.memberships m WHERE m.org_id IS DISTINCT FROM COALESCE(m.league_id, m.club_id))
        + (SELECT count(*) FROM public.org_sites s WHERE s.org_id IS DISTINCT FROM COALESCE(s.league_id, s.club_id))
        + (SELECT count(*) FROM public.seasons s WHERE s.org_id IS DISTINCT FROM COALESCE(s.league_id, s.club_id)))::text,
       CASE WHEN (SELECT count(*) FROM public.teams t WHERE t.org_id IS DISTINCT FROM COALESCE(t.league_id, t.club_id))
               + (SELECT count(*) FROM public.memberships m WHERE m.org_id IS DISTINCT FROM COALESCE(m.league_id, m.club_id))
               + (SELECT count(*) FROM public.org_sites s WHERE s.org_id IS DISTINCT FROM COALESCE(s.league_id, s.club_id))
               + (SELECT count(*) FROM public.seasons s WHERE s.org_id IS DISTINCT FROM COALESCE(s.league_id, s.club_id)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'ledger records 232', 'present',
       CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 232) THEN 'present' ELSE 'absent' END,
       CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 232) THEN 'OK' ELSE 'CHECK FAILED' END;
