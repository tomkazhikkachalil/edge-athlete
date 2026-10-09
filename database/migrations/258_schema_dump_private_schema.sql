-- ============================================================================
-- Migration 258 — the schema dump carries the `private` schema (Security
-- Advisor round, Oct 9 2026)
--
-- WHY: 257 moved the eight RLS helpers from public to `private` (out of the
-- Data API). `public.schema_dump()` (227 → 234) read functions from `public`
-- only, so the regenerated database/baseline/000_rebuild.sql carried the
-- policies that call private.has_profile_access(…) etc. — and neither the
-- schema nor the helpers. A new environment built from it would fail at the
-- first such policy. Caught by reading the regenerated baseline before
-- committing it.
--
-- WHAT: schema_dump() re-declared VERBATIM from the live definition
-- (identical on staging and production) with three changes:
--   1. a 'schemas' key — the app's non-API schemas (`private`) with the API
--      roles' USAGE and the comment;
--   2. each function carries 'schema';
--   3. functions are read from public AND private (ordered by schema, so
--      `private` comes first — a public body may name a helper).
-- scripts/rebuild-baseline-core.mjs emits the schemas and schema-qualifies
-- function grants and comments. Grants restated as live (service_role only).
--
-- Pre-flight: ledger head 257. Deploy order: FLEXIBLE (the generator reads
-- the new keys when present). Reversal: re-declare 234's body.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 258) THEN
    RAISE EXCEPTION '258 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 257 THEN RAISE EXCEPTION '258 pre-flight: ledger head is %, expected 257', n; END IF;
END $$;

-- ── 1. schema_dump(): public + private ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.schema_dump()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_buckets jsonb;
  v_cron    jsonb;
  v_seed    jsonb;
  v_ledger  jsonb;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'public', b.public,
             'file_size_limit', b.file_size_limit, 'allowed_mime_types', to_jsonb(b.allowed_mime_types)
           ) ORDER BY b.id), '[]'::jsonb)
      INTO v_buckets
      FROM storage.buckets b;
  EXCEPTION WHEN OTHERS THEN
    v_buckets := NULL;
  END;

  -- The cron commands carry a live bearer token (059 / 135 were run with
  -- CRON_SECRET pasted in): REDACTED here, so the secret never leaves the
  -- database — the rebuild carries the placeholder the files carry.
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'command', regexp_replace(j.command, 'Bearer [^''"\s]+', 'Bearer __CRON_SECRET__', 'g')
           ) ORDER BY j.jobname), '[]'::jsonb)
      INTO v_cron
      FROM cron.job j;
  EXCEPTION WHEN OTHERS THEN
    v_cron := NULL;
  END;

  -- Reference rows the app cannot run without. ONE table today:
  -- reserved_handles (the root-segment + system-path seed, 006 onward).
  -- `sports` is empty on prod (the registry lives in code); the golf
  -- catalog is DATA (28k courses), copied separately, never a baseline.
  BEGIN
    SELECT jsonb_build_object(
             'reserved_handles', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.handle), '[]'::jsonb) FROM public.reserved_handles r)
           )
      INTO v_seed;
  EXCEPTION WHEN OTHERS THEN
    v_seed := NULL;
  END;

  BEGIN
    SELECT jsonb_build_object('head', max(m.number), 'rows', count(*))
      INTO v_ledger
      FROM public.schema_migrations m;
  EXCEPTION WHEN OTHERS THEN
    v_ledger := NULL;
  END;

  RETURN jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 3,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version'),
      'ledger', v_ledger
    ),
    'schemas', (
      -- 258: the app's own non-API schemas (257 moved the RLS helpers into
      -- `private`), with the API roles' USAGE, so a rebuild creates them.
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', n.nspname,
               'usage', jsonb_build_object(
                 'anon', has_schema_privilege('anon', n.oid, 'USAGE'),
                 'authenticated', has_schema_privilege('authenticated', n.oid, 'USAGE'),
                 'service_role', has_schema_privilege('service_role', n.oid, 'USAGE')
               ),
               'comment', obj_description(n.oid, 'pg_namespace')
             ) ORDER BY n.nspname), '[]'::jsonb)
      FROM pg_namespace n
      WHERE n.nspname IN ('private')
    ),
    'extensions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) ORDER BY e.extname), '[]'::jsonb)
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql'
    ),
    'types', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', t.typname,
               'labels', (SELECT jsonb_agg(l.enumlabel ORDER BY l.enumsortorder) FROM pg_enum l WHERE l.enumtypid = t.oid)
             ) ORDER BY t.typname), '[]'::jsonb)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    ),
    'sequences', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', s.sequencename, 'data_type', s.data_type::text,
               'start', s.start_value, 'increment', s.increment_by, 'min', s.min_value, 'max', s.max_value, 'cycle', s.cycle,
               'owned_by', (
                 SELECT c.relname || '.' || a.attname
                 FROM pg_depend d
                 JOIN pg_class c ON c.oid = d.refobjid
                 JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
                 LIMIT 1
               ),
               'identity', EXISTS (
                 SELECT 1 FROM pg_depend d
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.deptype = 'i'
               ),
               'grants', jsonb_build_object(
                 'anon', has_sequence_privilege('anon', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'authenticated', has_sequence_privilege('authenticated', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'service_role', has_sequence_privilege('service_role', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE')
               )
             ) ORDER BY s.sequencename), '[]'::jsonb)
      FROM pg_sequences s
      WHERE s.schemaname = 'public'
    ),
    'tables', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname,
               'kind', c.relkind,
               'rls', c.relrowsecurity,
               'rls_forced', c.relforcerowsecurity,
               'comment', obj_description(c.oid, 'pg_class'),
               'columns', (
                 SELECT jsonb_agg(jsonb_build_object(
                          'name', a.attname,
                          'type', format_type(a.atttypid, a.atttypmod),
                          'not_null', a.attnotnull,
                          'default', pg_get_expr(d.adbin, d.adrelid),
                          'identity', a.attidentity,
                          'generated', a.attgenerated,
                          'comment', col_description(c.oid, a.attnum)
                        ) ORDER BY a.attnum)
                 FROM pg_attribute a
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               ),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname, 'name', k.conname, 'type', k.contype,
               'definition', pg_get_constraintdef(k.oid),
               'index', (SELECT i.relname FROM pg_class i WHERE i.oid = k.conindid AND k.conindid <> 0)
             ) ORDER BY c.relname, k.contype, k.conname), '[]'::jsonb)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'indexes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', i.tablename, 'name', i.indexname, 'definition', i.indexdef,
               'constraint', EXISTS (
                 SELECT 1 FROM pg_constraint k WHERE k.conindid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
               )
             ) ORDER BY i.tablename, i.indexname), '[]'::jsonb)
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
    ),
    'views', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname, 'materialized', c.relkind = 'm',
               'definition', pg_get_viewdef(c.oid, true),
               -- 234: the view's reloptions (security_invoker, check_option …) — pg_get_viewdef
               -- never carries them, and a rebuilt view without them is a different view.
               'options', to_jsonb(c.reloptions),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', n.nspname,
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'definition', pg_get_functiondef(p.oid),
               'grants', jsonb_build_object(
                 'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
               ),
               'comment', obj_description(p.oid, 'pg_proc')
             ) ORDER BY n.nspname, p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname IN ('public', 'private')
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
               'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
               'permissive', p.permissive, 'roles', to_jsonb(p.roles), 'cmd', p.cmd,
               'qual', p.qual, 'with_check', p.with_check
             ) ORDER BY p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public' OR (p.schemaname = 'storage' AND p.tablename = 'objects')
    ),
    'publications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('publication', pt.pubname, 'table', pt.tablename) ORDER BY pt.pubname, pt.tablename), '[]'::jsonb)
      FROM pg_publication_tables pt
      WHERE pt.schemaname = 'public'
    ),
    'storage_buckets', v_buckets,
    'cron_jobs', v_cron,
    'seed_rows', v_seed
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.schema_dump() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_dump() TO service_role;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (258, '258_schema_dump_private_schema.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 258 APPLIED | 1 | 8 | 258
SELECT '258 APPLIED' AS result,
       jsonb_array_length(public.schema_dump()->'schemas') AS schemas_expect_1,
       (SELECT count(*) FROM jsonb_array_elements(public.schema_dump()->'functions') f WHERE f->>'schema' = 'private') AS private_functions_expect_8,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_258;
