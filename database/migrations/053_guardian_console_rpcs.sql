-- ============================================================================
-- 053 — Guardian console RPCs + notification types (guardian feature, Phase 3a)
-- ============================================================================
-- ⚠️ Run AFTER 052. Safe anytime: nothing calls these until Phase-3a code
-- deploys with FEATURE_GUARDIAN_PROFILES on.
-- ============================================================================

-- ── create_managed_profile ──────────────────────────────────────────────────
-- Atomically: child profile + guardian access row + audit. The caller (route)
-- creates the shadow auth user FIRST via admin.createUser (auth API is not
-- reachable from SQL) and passes its id inside p_profile->>'id'.
CREATE OR REPLACE FUNCTION public.create_managed_profile(p_profile jsonb, p_guardian uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF (
    SELECT count(*) FROM public.profile_access
    WHERE user_id = p_guardian AND role = 'guardian'
  ) >= 10 THEN
    RAISE EXCEPTION 'guardian % manages too many profiles', p_guardian;
  END IF;

  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, p_profile)
  RETURNING id INTO new_id;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_guardian, new_id, 'guardian', p_guardian);

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (new_id, p_guardian, 'granted', 'guardian', p_guardian);

  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_managed_profile(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ── grant_guardian_access (co-guardian / invite redemption) ─────────────────
CREATE OR REPLACE FUNCTION public.grant_guardian_access(p_profile uuid, p_new_guardian uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.profile_access
    WHERE profile_id = p_profile AND role = 'guardian'
  ) >= 2 THEN
    RAISE EXCEPTION 'profile % already has the maximum of 2 guardians', p_profile;
  END IF;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_new_guardian, p_profile, 'guardian', p_actor)
  ON CONFLICT (user_id, profile_id) DO NOTHING;

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (p_profile, p_new_guardian, 'granted', 'guardian', p_actor);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_guardian_access(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── update_user_handle: allow NULL→value for owner/guardian ────────────────
-- The live body refuses when current handle IS NULL ('Profile not found') —
-- which blocked parents (created handle-less by Step A) and would block any
-- future handle-less rows. Body = Phase-0 dump verbatim, with the NULL case
-- rewritten to a first-time set, permitted only when the caller holds
-- owner/guardian access (RLS helper; SECURITY DEFINER context).
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

  -- First-time set (NULL → value): allowed for the profile itself or an
  -- access-holder; no rate limit (there is no prior handle to protect).
  IF current_handle IS NULL THEN
    IF NOT (p_profile_id = auth.uid()
            OR public.has_profile_access(p_profile_id, ARRAY['owner','guardian'])) THEN
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

  -- Case-only change
  IF LOWER(current_handle) = clean_new_handle THEN
    UPDATE public.profiles SET handle = p_new_handle WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle casing updated', p_new_handle;
    RETURN;
  END IF;

  -- Rate limiting: max 1 change per 7 days
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

-- ── notification types (028 DROP/re-ADD pattern) ────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'follow_request','follow_accepted','new_follower','like','comment',
  'comment_reply','mention','tag','achievement','system_announcement',
  'club_update','team_update','new_message','group_invite','group_update',
  'guardian_invite','athlete_added'
));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification
-- ============================================================================
-- 1. RPCs exist, server-only:
--    SELECT proname FROM pg_proc WHERE proname IN
--      ('create_managed_profile','grant_guardian_access');   -- 2 rows
-- 2. First-time handle set works (pick a NULL-handle profile id if one exists):
--    SELECT * FROM public.update_user_handle('<null-handle-profile-id>', 'testhandle123');
--    -- as service role: expect success=true. Roll back by setting handle NULL.
-- 3. Existing handle-change path regression:
--    SELECT * FROM public.update_user_handle('<your-profile-id>', '<your-current-handle>');
--    -- expect 'Handle casing updated' (case-only path intact).
-- 4. Notification types: INSERT with type='guardian_invite' (then delete) succeeds.
-- ============================================================================
