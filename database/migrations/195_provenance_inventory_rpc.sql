-- ============================================================================
-- 195: provenance_inventory() — the live catalog, read by npm run check:schema
--      (provenance round, PR A — Sep 15 2026)
-- ============================================================================
-- The data foundation program (190–194) gave every live TABLE and COLUMN
-- one owner in this chain, proven by `npm run check:schema` over PostgREST's
-- OpenAPI. Two things stayed unowned because the OpenAPI cannot see them:
-- RLS POLICIES (profiles' and golf_rounds' live policy names came from
-- archived scripts; migration 052 builds 18 policy names dynamically) and
-- FUNCTION BODIES (157 CREATE FUNCTIONs over 101 names, some redefined six
-- times, some dropped through pg_proc loops — nothing proves the chain's
-- LAST definition is what runs live; CREATE OR REPLACE is not a no-op
-- guard, the 025/082 class).
--
-- The P1 method was a one-statement pg_catalog dump the owner ran, exported
-- and pasted; a 552-row paste froze the terminal (Sep 14). Tom's decision:
-- a SERVICE-ROLE-ONLY RPC instead, so the check pulls the live catalog with
-- the service key and no owner paste is ever needed again. This function is
-- that RPC. It READS pg_catalog and nothing else — no table of the app, no
-- write, no side effect.
--
-- Shape (jsonb, version 1; every array ORDER BY'd so two runs diff clean):
--   meta       version · generated_at · role · server_version
--   rls        every public table: enabled / forced
--   policies   pg_policies, schema public: table · name · permissive ·
--              roles · cmd · qual · with_check (bodies as pg_get_expr prints)
--   functions  pg_proc, schema public, prokind f|p, EXTENSION-OWNED
--              EXCLUDED (pg_depend deptype 'e': show_limit, show_trgm,
--              unaccent live in public but belong to pg_trgm / unaccent):
--              name · identity_args · arg_types · returns · kind · language
--              · volatility · secdef · config · body_md5 = md5(prosrc) ·
--              body_md5_norm (CRLF→LF, trailing whitespace per line
--              stripped, outer trim — a paste artefact is not drift) ·
--              body_bytes · definition = pg_get_functiondef · acl · owner
--   triggers   pg_trigger, public, non-internal: table · name · enabled ·
--              definition — informational for now (a triggers facet is a
--              later pass; the baselines 190–191 recorded 13 tables' worth)
--
-- Why SECURITY INVOKER: pg_policies, pg_proc (prosrc included), pg_trigger
-- and pg_depend are world-readable catalogs and the pg_get_* functions do
-- no ACL checks, so DEFINER would buy nothing (094's reasoning — a grant
-- slip is then merely useless, never a leak). The service role sees
-- everything anyway. Zero-arg and never overloaded (PGRST203 fires before
-- grants on an ambiguous name). REVOKE before GRANT (the 087 pattern: CREATE
-- grants EXECUTE to PUBLIC by default). Deploy order is FLEXIBLE: the
-- runner treats a missing RPC (PGRST202) as "facets skipped", never as an
-- error, so this may run before or after the code that reads it.
--
-- Down-step (never needed for a no-op reader):
--   DROP FUNCTION IF EXISTS public.provenance_inventory();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provenance_inventory()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 1,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version')
    ),
    'rls', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname,
               'enabled', c.relrowsecurity,
               'forced', c.relforcerowsecurity
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', p.tablename,
               'name', p.policyname,
               'permissive', p.permissive,
               'roles', to_jsonb(p.roles),
               'cmd', p.cmd,
               'qual', p.qual,
               'with_check', p.with_check
             ) ORDER BY p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'arg_types', oidvectortypes(p.proargtypes),
               'returns', pg_get_function_result(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'volatility', p.provolatile,
               'secdef', p.prosecdef,
               'config', to_jsonb(p.proconfig),
               'body_md5', md5(p.prosrc),
               'body_md5_norm', md5(btrim(
                 regexp_replace(
                   regexp_replace(p.prosrc, E'\r\n', E'\n', 'g'),
                   E'[ \t]+\n', E'\n', 'g'),
                 E' \t\n')),
               'body_bytes', length(p.prosrc),
               'definition', pg_get_functiondef(p.oid),
               'acl', to_jsonb(p.proacl),
               'owner', pg_get_userbyid(p.proowner)
             ) ORDER BY p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
        )
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname,
               'name', t.tgname,
               'enabled', t.tgenabled,
               'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.provenance_inventory() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.provenance_inventory() TO service_role;

COMMENT ON FUNCTION public.provenance_inventory() IS
  'Read-only pg_catalog inventory (rls, policies, functions with body checksums, triggers) for npm run check:schema. Service-role only (migration 195).';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
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
