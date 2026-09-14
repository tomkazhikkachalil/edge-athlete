-- ============================================================================
-- DATA FOUNDATION, P1 — schema provenance: the live-truth dump
-- ============================================================================
-- ONE statement, ONE result. Run the whole file in the Supabase SQL editor,
-- then copy the result grid (the results panel's "Copy as Markdown") and
-- paste it back to Claude. READ-ONLY — nothing here modifies anything.
--
-- Why one statement: the editor shows only the LAST statement's result, so
-- the original eight-section version returned only grid 8 (the row counts)
-- three times over (Sep 13 2026). Every grid is now one UNION ALL branch
-- of a single SELECT, tagged by `grid`; multi-line definitions (policies,
-- function bodies) have their newlines replaced by " ⏎ " so every row
-- stays on one line when pasted as a table.
--
-- Why at all: 13 live tables (posts, post_comments, post_likes, post_media,
-- comment_likes, follows, athlete_equipment, sports, performances,
-- season_highlights, athlete_badges, privacy_settings,
-- connection_suggestions) are never CREATEd by the numbered chain — they
-- came from archived scripts, some under failed-attempts/ — and a handful
-- of live columns on chain-owned tables (golf_rounds' conditions,
-- profiles' measurables) exist only in loose or archived SQL. The baseline
-- migrations 190–193 are written from THIS dump, not from the archive:
-- migration 044 found live drift that had silently broken a route, and
-- PHASE 0 (guardian) established the method.
--
-- PostgREST's OpenAPI already gives columns, base types, defaults, PK/FK
-- targets and NOT NULL (`npm run check:schema`); it does NOT give numeric
-- precision, FK ON DELETE, CHECK/UNIQUE bodies, indexes, RLS state,
-- policies, triggers or grants. That is what these eight grids add.
--
-- The grids (the `grid` column):
--   1 columns      item = column, kind = type [NOT NULL], definition = default
--   2 constraints  item = name,   kind = p/f/c/u,          definition = the body
--   3 indexes      item = name,   kind = index,            definition = indexdef
--   4 rls+grants   item = table,  kind = rls on/off,       definition = grants
--   5 policies     item = name,   kind = cmd,              definition = roles | USING | WITH CHECK
--   6 triggers     item = name,   kind = enabled flag,     definition = triggerdef
--   7 functions    item = name,   kind = function,         definition = the body
--   8 row counts   item = table,  kind = rows,             definition = estimate
--
-- Precedent: database/phase0-guardian-live-dump.sql. Results go to
-- database/provenance/dumps/<date>-live-dump.md, committed verbatim.
-- ============================================================================

WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
),
one_line AS (
  -- newlines inside a definition would break a pasted table row
  SELECT E'\n' AS nl, ' ⏎ ' AS mark
),
grids AS (
  -- 1. Columns — type with precision (format_type), NOT NULL, default expression.
  SELECT 1 AS grid, c.relname::text AS table_name, a.attnum::int AS ord,
         a.attname::text AS item,
         format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END AS kind,
         COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS definition
  FROM pg_attribute a
  JOIN pg_class c      ON c.oid = a.attrelid
  JOIN pg_namespace n  ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN scope s         ON s.t = c.relname
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped

  UNION ALL
  -- 2. Constraints — PK / FK (with ON DELETE) / CHECK / UNIQUE, with their live names.
  SELECT 2, c.relname::text, 0, k.conname::text, k.contype::text, pg_get_constraintdef(k.oid)
  FROM pg_constraint k
  JOIN pg_class c     ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN scope s        ON s.t = c.relname

  UNION ALL
  -- 3. Indexes — the full definitions (the PK indexes are implied by grid 2).
  SELECT 3, i.tablename::text, 0, i.indexname::text, 'index'::text, i.indexdef
  FROM pg_indexes i
  JOIN scope s ON s.t = i.tablename
  WHERE i.schemaname = 'public' AND i.indexname NOT LIKE '%_pkey'

  UNION ALL
  -- 4. RLS state and table grants per role.
  SELECT 4, c.relname::text, 0, c.relname::text,
         'rls ' || CASE WHEN c.relrowsecurity THEN 'on' ELSE 'off' END || CASE WHEN c.relforcerowsecurity THEN ' forced' ELSE '' END,
         COALESCE((SELECT string_agg(g.grantee || ':' || g.privilege_type, ', ' ORDER BY g.grantee, g.privilege_type)
                   FROM information_schema.role_table_grants g
                   WHERE g.table_schema = 'public' AND g.table_name = c.relname
                     AND g.grantee IN ('anon', 'authenticated', 'service_role')), '')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN scope s        ON s.t = c.relname

  UNION ALL
  -- 5. RLS policies — bodies verbatim (the baseline copies them; it never "improves" them).
  SELECT 5, p.tablename::text, 0, p.policyname::text,
         p.cmd::text || CASE WHEN p.permissive = 'PERMISSIVE' THEN '' ELSE ' RESTRICTIVE' END,
         'roles=' || array_to_string(p.roles, ',') ||
         ' | USING: ' || COALESCE(p.qual, '-') ||
         ' | WITH CHECK: ' || COALESCE(p.with_check, '-')
  FROM pg_policies p
  JOIN scope s ON s.t = p.tablename
  WHERE p.schemaname = 'public'

  UNION ALL
  -- 6. Triggers — definitions (internal FK triggers excluded).
  SELECT 6, c.relname::text, 0, t.tgname::text, 'enabled=' || t.tgenabled::text, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN scope s        ON s.t = c.relname
  WHERE NOT t.tgisinternal

  UNION ALL
  -- 7. The trigger FUNCTION bodies (only these — a general function
  --    provenance pass is a separate job with its own no-op idiom).
  SELECT DISTINCT 7, '(function)'::text, 0, p.proname::text, 'function'::text, pg_get_functiondef(p.oid)
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN scope s        ON s.t = c.relname
  JOIN pg_proc p      ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal

  UNION ALL
  -- 8. Row counts (estimates) — the HARDENING B1 question: is a table large
  --    enough that any FUTURE index must be built CONCURRENTLY?
  SELECT 8, c.relname::text, 0, c.relname::text, 'rows'::text, c.reltuples::bigint::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN scope s        ON s.t = c.relname
)
SELECT g.grid, g.table_name, g.item, g.kind,
       replace(g.definition, o.nl, o.mark) AS definition
FROM grids g CROSS JOIN one_line o
ORDER BY g.grid, g.table_name, g.ord, g.item;
