-- verify-255-golf-map-sweep.sql — the check grid for migration 255 (read-only).
-- Run after 255 on staging and prod; every row should
-- read true except the cron row, which is false on staging by decision.
SELECT 'golf_map_sweep_cells table, RLS on' AS check_name,
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'golf_map_sweep_cells' AND rowsecurity) AS pass
UNION ALL
SELECT 'golf_map_sweep_meta table, RLS on',
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'golf_map_sweep_meta' AND rowsecurity)
UNION ALL
SELECT 'no policies on either (posture A)',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('golf_map_sweep_cells', 'golf_map_sweep_meta'))
UNION ALL
SELECT 'anon / authenticated hold no privilege on either',
       NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                   WHERE table_schema = 'public' AND table_name IN ('golf_map_sweep_cells', 'golf_map_sweep_meta') AND grantee IN ('anon', 'authenticated'))
UNION ALL
SELECT 'status CHECK names pending / running / done',
       (SELECT pg_get_constraintdef(oid) LIKE '%''pending''%' AND pg_get_constraintdef(oid) LIKE '%''running''%' AND pg_get_constraintdef(oid) LIKE '%''done''%'
          FROM pg_constraint WHERE conname = 'golf_map_sweep_cells_status_check')
UNION ALL
SELECT 'the due index exists',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_map_sweep_cells_due')
UNION ALL
SELECT 'the elevation-due partial index exists',
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_courses_elevation_due')
UNION ALL
SELECT 'golf_map_sweep_claim exists; anon / authenticated cannot execute',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'golf_map_sweep_claim')
       AND NOT has_function_privilege('anon', 'public.golf_map_sweep_claim(integer, integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.golf_map_sweep_claim(integer, integer)', 'EXECUTE')
UNION ALL
SELECT 'golf_map_sweep_elevation_due exists; anon / authenticated cannot execute',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'golf_map_sweep_elevation_due')
       AND NOT has_function_privilege('anon', 'public.golf_map_sweep_elevation_due(integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.golf_map_sweep_elevation_due(integer)', 'EXECUTE')
UNION ALL
SELECT 'no leaked qa-e2e course older than an hour',
       NOT EXISTS (SELECT 1 FROM public.golf_courses WHERE external_source = 'qa-e2e' AND created_at < timezone('utc'::text, now()) - interval '1 hour')
UNION ALL
SELECT 'the cron job is scheduled (production only — false on staging by decision)',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'golf-map-sweep')
UNION ALL
SELECT 'ledger head is 255',
       (SELECT max(number) = 255 FROM public.schema_migrations);
