-- ============================================================================
-- Verify migration 202 (participants, groups, group members)
-- ============================================================================
-- READ ONLY. Safe to run any time. The same grid 202 ends with: the tables
-- exist, RLS is on with zero policies, anon cannot read, the constraint /
-- index / trigger counts match. Every row should read OK.
-- ============================================================================

SELECT 'three tables' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name IN ('sport_event_participants', 'sport_event_groups', 'sport_event_group_members')

UNION ALL

SELECT 'rls on, zero policies, all three', 'true',
       (bool_and(c.relrowsecurity) AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename LIKE 'sport_event_%'))::text,
       CASE WHEN bool_and(c.relrowsecurity) AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename LIKE 'sport_event_%') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c WHERE c.oid IN ('public.sport_event_participants'::regclass, 'public.sport_event_groups'::regclass, 'public.sport_event_group_members'::regclass)

UNION ALL

SELECT 'anon cannot read any', 'false',
       (has_table_privilege('anon', 'public.sport_event_participants', 'SELECT')
        OR has_table_privilege('anon', 'public.sport_event_groups', 'SELECT')
        OR has_table_privilege('anon', 'public.sport_event_group_members', 'SELECT'))::text,
       CASE WHEN has_table_privilege('anon', 'public.sport_event_participants', 'SELECT')
              OR has_table_privilege('anon', 'public.sport_event_groups', 'SELECT')
              OR has_table_privilege('anon', 'public.sport_event_group_members', 'SELECT') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'participants: one row per (event, profile)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_participants_uniq' AND contype = 'u'

UNION ALL

SELECT 'members: one group per participant per round', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_group_members_round_uniq' AND contype = 'u'

UNION ALL

SELECT 'members: round matches the group''s round', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_group_members m JOIN sport_event_groups g ON g.id = m.group_id
 WHERE m.sport_event_round_id <> g.sport_event_round_id

UNION ALL

SELECT 'participants: constraints', '10', count(*)::text,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_participants'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public'
   AND indexname IN ('idx_sport_event_participants_event_status', 'idx_sport_event_participants_profile_created', 'idx_sport_event_groups_round_sequence', 'idx_sport_event_group_members_group_position')

UNION ALL

SELECT 'updated_at triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname IN ('sport_event_participants_updated_at', 'sport_event_groups_updated_at') AND NOT tgisinternal

ORDER BY 1;
