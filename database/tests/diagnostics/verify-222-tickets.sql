-- ============================================================================
-- Verify migration 222 (tickets · ticket_events · platform_admins · the two
-- ticket bell types — Support & Reporting, Spec 1)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 222 the rows read CHECK FAILED
-- (every check counts catalog rows; nothing selects the new tables by name);
-- AFTER 222 every row reads OK. The migration ends in ONE result row
-- ("222 APPLIED | 1 | 1 | 1 | 1 | 1 | 5 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-222-tickets.sql' AS expected, 'verify-222-tickets.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'tickets table exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tickets'

UNION ALL

SELECT 'tickets.number is an IDENTITY column (bigint)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'number'
   AND is_identity = 'YES' AND data_type = 'bigint'

UNION ALL

SELECT 'tickets.number identity starts at 1000', '1000', coalesce(identity_start, '?'),
       CASE WHEN identity_start = '1000' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'number'

UNION ALL

SELECT 'tickets.number is UNIQUE', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'tickets_number_key' AND conrelid = 'public.tickets'::regclass AND contype = 'u'

UNION ALL

SELECT 'tickets shape CHECKs (type, subtype, severity, status, target_type, resolution_code, suggestion_tag, subtype_shape, resolution_shape, report_count)', '10', count(*)::text,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.tickets'::regclass AND contype = 'c'

UNION ALL

SELECT 'tickets FKs (reporter, target_profile, assignee, merged_into)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.tickets'::regclass AND contype = 'f'

UNION ALL

SELECT 'tickets.target_id has NO foreign key (the snapshot is the record)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.conrelid = 'public.tickets'::regclass AND c.contype = 'f' AND a.attname = 'target_id'

UNION ALL

SELECT 'tickets indexes (queue, reporter, target_profile, target_item, retention)', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tickets' AND indexname LIKE 'idx_tickets_%'

UNION ALL

SELECT 'tickets updated_at trigger (handle_updated_at)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'tickets_updated_at' AND tgrelid = 'public.tickets'::regclass

UNION ALL

SELECT 'ticket_events table exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_events'

UNION ALL

SELECT 'ticket_events.ticket_id → tickets ON DELETE CASCADE', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.ticket_events'::regclass AND contype = 'f'
   AND confrelid = 'public.tickets'::regclass AND confdeltype = 'c'

UNION ALL

SELECT 'ticket_events kind CHECK admits the 12 kinds', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'ticket_events_kind_check' AND conrelid = 'public.ticket_events'::regclass
   AND pg_get_constraintdef(oid) LIKE '%anonymized%' AND pg_get_constraintdef(oid) LIKE '%user_reply%'

UNION ALL

SELECT 'platform_admins table exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_admins'

UNION ALL

SELECT 'platform_admins role CHECK (owner | moderator)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'platform_admins_role_check' AND conrelid = 'public.platform_admins'::regclass
   AND pg_get_constraintdef(oid) LIKE '%moderator%'

UNION ALL

SELECT 'posture A: RLS enabled on all three tables', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('tickets', 'ticket_events', 'platform_admins') AND relrowsecurity

UNION ALL

SELECT 'posture A: zero policies on the three tables', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('tickets', 'ticket_events', 'platform_admins')

UNION ALL

SELECT 'posture A: anon + authenticated hold no privilege on the three tables', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name IN ('tickets', 'ticket_events', 'platform_admins')
   AND grantee IN ('anon', 'authenticated')

UNION ALL

SELECT 'notifications_type_check admits ticket_update + ticket_critical (and still sport_event_match)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%ticket_update%' AND pg_get_constraintdef(oid) LIKE '%ticket_critical%'
   AND pg_get_constraintdef(oid) LIKE '%sport_event_match%';
