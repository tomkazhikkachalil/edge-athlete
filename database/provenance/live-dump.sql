-- ============================================================================
-- DATA FOUNDATION, P1 — schema provenance: the live-truth dump
-- ============================================================================
-- Run each section in the Supabase SQL editor and paste the result grids
-- back to Claude. READ-ONLY — nothing here modifies anything.
--
-- Why: 13 live tables (posts, post_comments, post_likes, post_media,
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
-- Precedent: database/phase0-guardian-live-dump.sql. Results go to
-- database/provenance/dumps/<date>-live-dump.md, committed verbatim.
-- ============================================================================

-- The tables in scope: the 13 pre-chain tables + the two chain-owned tables
-- with unowned columns. Every query below joins this set.
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
-- 1. Columns — type with precision (format_type), NOT NULL, default expression.
SELECT c.relname AS table_name,
       a.attnum   AS ordinal,
       a.attname  AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attribute a
JOIN pg_class c      ON c.oid = a.attrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN scope s         ON s.t = c.relname
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- 2. Constraints — PK / FK (with ON DELETE) / CHECK / UNIQUE, with their live names.
--    Answers: does golf_rounds still carry 002's holes CHECK? What is the
--    round_type CHECK called? Which FKs point at auth.users vs profiles?
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT c.relname AS table_name,
       k.conname,
       k.contype,
       pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k
JOIN pg_class c     ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN scope s        ON s.t = c.relname
ORDER BY c.relname, k.contype, k.conname;

-- 3. Indexes — the full definitions (the PK indexes are implied by grid 2).
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT i.tablename, i.indexname, i.indexdef
FROM pg_indexes i
JOIN scope s ON s.t = i.tablename
WHERE i.schemaname = 'public' AND i.indexname NOT LIKE '%_pkey'
ORDER BY i.tablename, i.indexname;

-- 4. RLS state and table grants per role.
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT string_agg(g.grantee || ':' || g.privilege_type, ', ' ORDER BY g.grantee, g.privilege_type)
        FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = c.relname
          AND g.grantee IN ('anon', 'authenticated', 'service_role')) AS grants
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN scope s        ON s.t = c.relname
ORDER BY c.relname;

-- 5. RLS policies — bodies verbatim (the baseline copies them; it never "improves" them).
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT p.tablename, p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check
FROM pg_policies p
JOIN scope s ON s.t = p.tablename
WHERE p.schemaname = 'public'
ORDER BY p.tablename, p.policyname;

-- 6. Triggers — definitions (internal FK triggers excluded).
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT c.relname AS table_name, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN scope s        ON s.t = c.relname
WHERE NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 7. The trigger FUNCTION bodies (only these — a general function
--    provenance pass is a separate job with its own no-op idiom).
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN scope s        ON s.t = c.relname
JOIN pg_proc p      ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
ORDER BY p.proname;

-- 8. Row counts (estimates) — the HARDENING B1 question: is a table large
--    enough that any FUTURE index must be built CONCURRENTLY?
WITH scope(t) AS (
  VALUES ('posts'), ('post_comments'), ('post_likes'), ('post_media'),
         ('comment_likes'), ('follows'), ('athlete_equipment'), ('sports'),
         ('performances'), ('season_highlights'), ('athlete_badges'),
         ('privacy_settings'), ('connection_suggestions'),
         ('golf_rounds'), ('profiles')
)
SELECT c.relname AS table_name, c.reltuples::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN scope s        ON s.t = c.relname
ORDER BY c.relname;
