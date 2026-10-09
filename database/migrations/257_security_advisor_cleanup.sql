-- ============================================================================
-- Migration 257 — clear the Supabase Security Advisor's warnings without
-- changing what anyone can see or do (Security Advisor round, Oct 9 2026)
--
-- WHY: Tom pasted production's Security Advisor — 31 WARN items, all
-- SECURITY — and asked for a plan to fix everything without breaking
-- anything. Several items are flagged because they work AS DESIGNED (RLS
-- helpers that must be executable by the calling role; 063 granted the golf
-- ones to anon on purpose so public live rounds read signed out), so the fix
-- is to move them, never to revoke what RLS needs.
--
-- WHAT, item by item:
--   1. function_search_path_mutable — public.haversine_km: pure pg_catalog
--      maths → SET search_path = ''.
--   2. *_security_definer_function_executable — increment_/decrement_
--      comment_likes_count: TRIGGER functions; firing a trigger needs no
--      EXECUTE by the caller → REVOKE from PUBLIC, anon, authenticated.
--   3. *_security_definer_function_executable — the eight RLS helpers
--      (can_view_group_post, participant_group_post, hole_score_group_post,
--      is_group_post_creator / _organizer / _participant, has_profile_access,
--      is_conversation_participant): MOVED to the non-API schema `private`
--      (Supabase's documented remedy). Policies reference functions by OID
--      and the EXECUTE grants travel with the function, so RLS is unchanged;
--      they simply stop being callable at /rest/v1/rpc/…. No app code calls
--      them by RPC (audited). Their bodies are schema-qualified or carry
--      their own search_path (audited).
--   4. The ONE function body that named a moved helper —
--      public.update_user_handle (search_path '') called
--      public.has_profile_access — is re-declared VERBATIM from the live
--      definition (identical on staging and production) with only that call
--      changed to private.has_profile_access; its grants restated as live
--      (service_role only).
--   5. *_security_definer_function_executable — resolve_org_site_host /
--      resolve_org_site_domain (171): the middleware now calls them with the
--      server key (PR A, #1140 — MUST be live before this runs) → REVOKE
--      from PUBLIC, anon, authenticated; GRANT service_role.
--   6. extension_in_public — pg_trgm, unaccent → SET SCHEMA extensions.
--      Indexes reference their opclasses by OID; the one function that calls
--      unaccent (search_normalize) has search_path = public, extensions; no
--      function calls a trigram function (audited: the regex hits were
--      RAISE '%' placeholders).
--   7. extension_in_public — pg_net: ACCEPTED, NOT MOVED (Tom). pg_net does
--      not support SET SCHEMA; moving it means DROP + CREATE, which pauses
--      the pg_cron jobs that call net.http_post. Its objects live in the
--      `net` schema regardless; only the extension's record is in public.
--   8. auth_leaked_password_protection — a dashboard toggle, not SQL:
--      Authentication → Attack Protection → "Prevent use of leaked passwords".
--
-- Pre-flight: ledger head 256. Deploy order: AFTER PR A (#1140) is live on
-- the target (production's middleware must send the server key first).
-- Reversal (instant, data-safe): ALTER FUNCTION private.<helper> SET SCHEMA
-- public; re-GRANT the revoked EXECUTEs (anon, authenticated); ALTER
-- EXTENSION pg_trgm / unaccent SET SCHEMA public; re-declare
-- update_user_handle with public.has_profile_access (054's body).
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 257) THEN
    RAISE EXCEPTION '257 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 256 THEN RAISE EXCEPTION '257 pre-flight: ledger head is %, expected 256', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RAISE EXCEPTION '257 pre-flight: the extensions schema is missing';
  END IF;
END $$;

-- ── 1. haversine_km: a fixed search_path ────────────────────────────────────
ALTER FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) SET search_path = '';

-- ── 2. The comment-like trigger functions: nobody calls them directly ───────
REVOKE EXECUTE ON FUNCTION public.increment_comment_likes_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_comment_likes_count() FROM PUBLIC, anon, authenticated;

-- ── 3. The RLS helpers move to `private` (not exposed by the Data API) ──────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
COMMENT ON SCHEMA private IS 'SECURITY DEFINER helpers that RLS policies call (257). Never exposed through the Data API; the policies reach them by OID.';

DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'can_view_group_post(uuid)',
    'participant_group_post(uuid)',
    'hole_score_group_post(uuid)',
    'is_group_post_creator(uuid)',
    'is_group_post_organizer(uuid)',
    'is_group_post_participant(uuid)',
    'has_profile_access(uuid, text[])',
    'is_conversation_participant(uuid, uuid)'
  ] LOOP
    IF to_regprocedure('public.' || sig) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%s SET SCHEMA private', sig);
    ELSIF to_regprocedure('private.' || sig) IS NULL THEN
      RAISE EXCEPTION '257: helper % is in neither public nor private', sig;
    END IF;
  END LOOP;
END $$;

-- ── 4. update_user_handle: the one body that named a moved helper ───────────
-- VERBATIM from the live definition; the only change is
-- public.has_profile_access → private.has_profile_access.
CREATE OR REPLACE FUNCTION public.update_user_handle(p_profile_id uuid, p_new_handle text)
 RETURNS TABLE(success boolean, message text, new_handle text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  current_handle TEXT;
  profile_exists BOOLEAN;
  clean_new_handle TEXT;
  last_change TIMESTAMP WITH TIME ZONE;
  change_count INT;
  availability_result RECORD;
  jwt_role TEXT;
BEGIN
  SELECT TRUE, handle, handle_updated_at, handle_change_count
  INTO profile_exists, current_handle, last_change, change_count
  FROM public.profiles
  WHERE id = p_profile_id;

  IF profile_exists IS NOT TRUE THEN
    RETURN QUERY SELECT FALSE, 'Profile not found', NULL::TEXT;
    RETURN;
  END IF;

  clean_new_handle := LOWER(TRIM(p_new_handle));

  IF current_handle IS NULL THEN
    jwt_role := COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'role', '');
    IF NOT (jwt_role = 'service_role'
            OR p_profile_id = auth.uid()
            OR private.has_profile_access(p_profile_id, ARRAY['owner','guardian'])) THEN
      RETURN QUERY SELECT FALSE, 'Not permitted to set this handle', NULL::TEXT;
      RETURN;
    END IF;
    SELECT * INTO availability_result
    FROM public.check_handle_availability(clean_new_handle, p_profile_id);
    IF NOT availability_result.available THEN
      RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
      RETURN;
    END IF;
    UPDATE public.profiles
    SET handle = p_new_handle, handle_updated_at = NOW(),
        handle_change_count = COALESCE(change_count, 0)
    WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle set successfully!', p_new_handle;
    RETURN;
  END IF;

  IF LOWER(current_handle) = clean_new_handle THEN
    UPDATE public.profiles SET handle = p_new_handle WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle casing updated', p_new_handle;
    RETURN;
  END IF;

  IF last_change IS NOT NULL AND last_change > NOW() - INTERVAL '7 days' THEN
    RETURN QUERY SELECT
      FALSE,
      'You can only change your handle once per week. Next available: ' ||
        TO_CHAR(last_change + INTERVAL '7 days', 'Mon DD, YYYY'),
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO availability_result
  FROM public.check_handle_availability(clean_new_handle, p_profile_id);
  IF NOT availability_result.available THEN
    RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.handle_history (profile_id, old_handle, new_handle)
  VALUES (p_profile_id, current_handle, clean_new_handle);

  UPDATE public.profiles
  SET handle = p_new_handle,
      handle_updated_at = NOW(),
      handle_change_count = COALESCE(change_count, 0) + 1
  WHERE id = p_profile_id;

  RETURN QUERY SELECT
    TRUE,
    'Handle updated successfully! Old @mentions will redirect for 30 days.',
    p_new_handle;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.update_user_handle(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_handle(uuid, text) TO service_role;

-- ── 5. The custom-domain lookups: the server key only (PR A, #1140) ─────────
REVOKE EXECUTE ON FUNCTION public.resolve_org_site_host(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_org_site_domain(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_org_site_host(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_org_site_domain(text) TO service_role;

-- ── 6. pg_trgm and unaccent out of public ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm' AND n.nspname = 'public') THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent' AND n.nspname = 'public') THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  END IF;
END $$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (257, '257_security_advisor_cleanup.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 257 APPLIED | 8 | 0 | 0 | 2 | 257
SELECT '257 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private'
           AND p.proname IN ('can_view_group_post','participant_group_post','hole_score_group_post','is_group_post_creator','is_group_post_organizer','is_group_post_participant','has_profile_access','is_conversation_participant')) AS helpers_in_private_expect_8,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('can_view_group_post','participant_group_post','hole_score_group_post','is_group_post_creator','is_group_post_organizer','is_group_post_participant','has_profile_access','is_conversation_participant')) AS helpers_in_public_expect_0,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN ('resolve_org_site_host','resolve_org_site_domain')
           AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon_lookups_expect_0,
       (SELECT count(*) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname IN ('pg_trgm','unaccent') AND n.nspname = 'extensions') AS extensions_moved_expect_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_257;
