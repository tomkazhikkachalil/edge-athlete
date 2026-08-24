-- ============================================================================
-- 114: SECURITY DEFINER on the search trigger functions — unbreak auth-side
--      cascades
-- ============================================================================
-- Found by the first e2e teardown after 112/113: `auth.admin.deleteUser`
-- failed with "Database error deleting user" for any user whose profiles row
-- still existed. Cause: deleting an auth user cascades auth.users → profiles,
-- and that DELETE fires `profiles_search_doc_delete` AS supabase_auth_admin —
-- a role with no privileges on `search_documents` (112 revoked ALL from
-- PUBLIC/anon/authenticated and left RLS on with zero policies). The trigger
-- errored, and the whole user deletion rolled back with it.
--
-- Blast radius, measured: the APP's account deletion was never broken —
-- hardDeleteAccount deletes the profiles row through the service role
-- (BYPASSRLS) BEFORE calling deleteUser, so the cascade never fires the
-- trigger as auth_admin. What broke was every auth-FIRST deletion: the e2e
-- teardown (now also profile-first, belt and braces) and deleting a user
-- from the Supabase dashboard.
--
-- Fix: the search maintenance triggers must succeed NO MATTER which role's
-- statement fires them — that is exactly what SECURITY DEFINER is for. Every
-- function here already pins `SET search_path = public, extensions` (the
-- definer-hygiene requirement). The vector-update functions are included for
-- uniformity: they read `places` via place_context(), and the same
-- wrong-role class would hit them on any non-service-role write.
--
-- Run AFTER 113. Re-runnable.
-- ============================================================================

ALTER FUNCTION public.search_document_delete() SECURITY DEFINER;
ALTER FUNCTION public.search_doc_sync_course() SECURITY DEFINER;
ALTER FUNCTION public.search_doc_sync_athlete() SECURITY DEFINER;
ALTER FUNCTION public.search_doc_sync_club() SECURITY DEFINER;
ALTER FUNCTION public.search_doc_sync_post() SECURITY DEFINER;
ALTER FUNCTION public.search_doc_sync_league() SECURITY DEFINER;

ALTER FUNCTION public.places_search_vector_update() SECURITY DEFINER;
ALTER FUNCTION public.golf_courses_search_vector_update() SECURITY DEFINER;
ALTER FUNCTION public.profiles_search_vector_update() SECURITY DEFINER;
ALTER FUNCTION public.clubs_search_vector_update() SECURITY DEFINER;
ALTER FUNCTION public.leagues_search_vector_update() SECURITY DEFINER;

-- Trigger functions are never called directly; keep them uncallable anyway
-- (SECURITY DEFINER + EXECUTE would otherwise be a tiny lateral surface).
REVOKE EXECUTE ON FUNCTION public.search_document_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_course() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_athlete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_club() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_post() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_league() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.places_search_vector_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.golf_courses_search_vector_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profiles_search_vector_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clubs_search_vector_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leagues_search_vector_update() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; every boolean must read true) ───────────────────
SELECT
  (SELECT count(*) FROM pg_proc p
   WHERE p.proname IN (
     'search_document_delete', 'search_doc_sync_course', 'search_doc_sync_athlete',
     'search_doc_sync_club', 'search_doc_sync_post', 'search_doc_sync_league',
     'places_search_vector_update', 'golf_courses_search_vector_update',
     'profiles_search_vector_update', 'clubs_search_vector_update',
     'leagues_search_vector_update')
     AND p.prosecdef) = 11 AS all_eleven_definer,
  (SELECT count(*) FROM pg_proc p
   WHERE p.proname LIKE 'search_doc_sync_%' AND NOT p.prosecdef) = 0 AS no_sync_invoker_left,
  NOT has_function_privilege('anon', 'public.search_document_delete()', 'EXECUTE') AS delete_fn_anon_revoked,
  -- The actual failure mode, reproduced in SQL: a profiles delete must fire
  -- the doc-delete trigger without error whatever the caller. (SELECT-only
  -- probe: prosecdef is the property that fixes it; the grid can't switch
  -- roles, so live proof stays with the e2e teardown.)
  (SELECT p.prosecdef FROM pg_proc p WHERE p.proname = 'profiles_search_vector_update') AS profiles_vector_definer;
