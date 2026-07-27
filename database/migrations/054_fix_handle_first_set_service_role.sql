-- ============================================================================
-- 054 — Fix: update_user_handle first-time set under the service-role client
-- ============================================================================
-- ⚠️ Run AFTER 053. Bug in 053's NULL→value branch: the permission check
-- relies on auth.uid(), but the app's /api/handles/update route calls this
-- RPC with the SERVICE-ROLE client where auth.uid() IS NULL — every
-- legitimate first-time set was refused. The route does requireAuth + its own
-- authorization, so service-role calls are trusted; anon stays blocked
-- (role claim check, not a NULL check).
-- Only the first-time-set permission clause changes; everything else is 053
-- verbatim.
-- ============================================================================

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

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification (service-role context, i.e. the SQL editor / PostgREST admin)
-- ============================================================================
-- 1. First-time set works via service role (pick/craft a NULL-handle profile):
--    SELECT * FROM public.update_user_handle('<null-handle-profile-id>', 'qa_first_set');
--    -- expect success=true. Undo: UPDATE profiles SET handle=NULL, ...
-- 2. Existing-handle change path unchanged:
--    SELECT * FROM public.update_user_handle('<your-id>', '<your-current-handle>');
--    -- expect 'Handle casing updated'
-- ============================================================================
