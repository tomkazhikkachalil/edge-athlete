-- ============================================================================
-- PHASE 0 — Guardian-profiles feature: live-schema reconciliation dump
-- ============================================================================
-- Run each section in the Supabase SQL editor and paste the results back to
-- Claude. READ-ONLY — nothing here modifies anything.
--
-- Why: database/archive contains conflicting DDL (follows may FK auth.users
-- directly; on_auth_user_created may or may not still exist; several RPC
-- bodies live only in the DB). Migrations 048+ must be written against the
-- live truth, not the repo's canon. Precedent: migration 044 found live drift
-- that had silently broken a route.
-- ============================================================================

-- 1. Does the signup trigger still exist? (048/049 ordering depends on this)
SELECT tgname, tgrelid::regclass AS on_table, tgenabled
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- 2. follows FK targets — the critical archive conflict:
--    profiles(id) [fine] vs auth.users(id) [second coupling point]
SELECT conname,
       conrelid::regclass  AS on_table,
       confrelid::regclass AS references_table,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'follows'::regclass AND contype = 'f';

-- 3. All FKs pointing at profiles(id) with their ON DELETE behavior
--    (sanity vs the repo-derived list of ~45 tables)
SELECT conrelid::regclass AS from_table,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE confrelid = 'profiles'::regclass AND contype = 'f'
ORDER BY 1;

-- 4. profiles constraints (email uniqueness, display_name check, PK/FK)
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'profiles'::regclass
ORDER BY contype, conname;

-- 5. RLS policies on the tables the guardian feature touches
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','posts','post_media','follows','golf_rounds',
                    'golf_holes','athlete_vitals','athlete_achievements',
                    'athlete_equipment','workout_sessions','workout_exercises',
                    'workout_sets','season_highlights','performances')
ORDER BY tablename, policyname;

-- 6. DB-only function bodies that filter by ownership/visibility
--    (bodies are NOT in the repo — 021's documented hazard)
SELECT p.proname, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname LIKE 'get_profile%media'
       OR p.proname IN ('can_view_profile','search_profiles','search_posts',
                        'handle_new_user','update_user_handle',
                        'check_handle_availability',
                        'generate_connection_suggestions'));

-- 7. Storage buckets (consent evidence needs a PRIVATE bucket; verify what exists)
SELECT id, name, public FROM storage.buckets ORDER BY name;
