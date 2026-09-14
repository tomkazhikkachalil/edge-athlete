-- ============================================================================
-- Verify migration 195 (provenance_inventory RPC) — present, locked, complete
-- ============================================================================
-- READ ONLY. Safe to run any time, as often as you like. Nothing here modifies
-- the database (the RPC it calls only reads pg_catalog).
--
-- The same grid 195 ends with: the function exists, anon and authenticated
-- cannot execute it, service_role can, it runs as the invoker, and its
-- inventory lists policies, functions (extension-owned excluded, itself
-- included) and triggers. The last row is informational: the response size
-- in bytes — if it ever grows past a few MB, split the RPC (MIGRATIONS.md).
--
-- Every row should read OK.
-- ============================================================================

WITH inv AS (SELECT public.provenance_inventory() AS j)

SELECT 'rpc present' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'provenance_inventory'

UNION ALL

SELECT 'anon cannot execute', 'false',
       has_function_privilege('anon', 'public.provenance_inventory()', 'EXECUTE')::text,
       CASE WHEN has_function_privilege('anon', 'public.provenance_inventory()', 'EXECUTE') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'authenticated cannot execute', 'false',
       has_function_privilege('authenticated', 'public.provenance_inventory()', 'EXECUTE')::text,
       CASE WHEN has_function_privilege('authenticated', 'public.provenance_inventory()', 'EXECUTE') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'service_role can execute', 'true',
       has_function_privilege('service_role', 'public.provenance_inventory()', 'EXECUTE')::text,
       CASE WHEN has_function_privilege('service_role', 'public.provenance_inventory()', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'security invoker', 'false', p.prosecdef::text,
       CASE WHEN p.prosecdef THEN 'CHECK FAILED' ELSE 'OK' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'provenance_inventory'

UNION ALL

SELECT 'policies listed', '> 0', jsonb_array_length(j->'policies')::text,
       CASE WHEN jsonb_array_length(j->'policies') > 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM inv

UNION ALL

SELECT 'functions listed', '> 0', jsonb_array_length(j->'functions')::text,
       CASE WHEN jsonb_array_length(j->'functions') > 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM inv

UNION ALL

SELECT 'extension functions excluded', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM inv, jsonb_array_elements(j->'functions') f
 WHERE f->>'name' IN ('show_limit', 'show_trgm', 'unaccent')

UNION ALL

SELECT 'inventories itself', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM inv, jsonb_array_elements(j->'functions') f
 WHERE f->>'name' = 'provenance_inventory'

UNION ALL

SELECT 'triggers listed', '> 0', jsonb_array_length(j->'triggers')::text,
       CASE WHEN jsonb_array_length(j->'triggers') > 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM inv

UNION ALL

SELECT 'response bytes (info)', 'info', pg_column_size(j)::text, 'OK'
  FROM inv;
