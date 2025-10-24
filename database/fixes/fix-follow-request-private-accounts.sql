-- =====================================================
-- FIX FOLLOW REQUEST FOR PRIVATE ACCOUNTS
-- =====================================================
-- Purpose: Fix the notify_follow_request trigger to work with private accounts
-- Issue: Function call not schema-qualified when search_path = ''
-- Solution: Add public. prefix to create_notification call
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FIXING FOLLOW REQUEST FOR PRIVATE ACCOUNTS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- SECTION 1: DROP AND RECREATE notify_follow_request
-- =====================================================

DROP TRIGGER IF EXISTS trigger_notify_follow_request ON public.follows CASCADE;
DROP FUNCTION IF EXISTS public.notify_follow_request() CASCADE;

CREATE FUNCTION public.notify_follow_request()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    -- SCHEMA-QUALIFIED profiles table
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM public.profiles WHERE id = NEW.follower_id;

    -- SCHEMA-QUALIFIED function call (THIS IS THE FIX!)
    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'follow_request',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' sent you a follow request',
      p_message := NEW.message,
      p_action_url := '/app/followers?tab=requests',
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id, 'action_status', 'pending')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_follow_request();

-- =====================================================
-- SECTION 2: ALSO FIX notify_follow_accepted
-- =====================================================

DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON public.follows CASCADE;
DROP FUNCTION IF EXISTS public.notify_follow_accepted() CASCADE;

CREATE FUNCTION public.notify_follow_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    -- Update the original follow_request notification status
    UPDATE public.notifications
    SET action_status = 'accepted',
        action_taken_at = NOW()
    WHERE follow_id = NEW.id
      AND type = 'follow_request';

    -- Create follow_accepted notification for the requester
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM public.profiles WHERE id = NEW.following_id;

    -- SCHEMA-QUALIFIED function call
    PERFORM public.create_notification(
      p_user_id := NEW.follower_id,
      p_type := 'follow_accepted',
      p_actor_id := NEW.following_id,
      p_title := v_actor_name || ' accepted your follow request',
      p_action_url := '/athlete/' || NEW.following_id,
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_follow_accepted();

-- =====================================================
-- SECTION 3: ALSO FIX notify_new_follower
-- =====================================================

DROP TRIGGER IF EXISTS trigger_notify_new_follower ON public.follows CASCADE;
DROP FUNCTION IF EXISTS public.notify_new_follower() CASCADE;

CREATE FUNCTION public.notify_new_follower()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'accepted' THEN
    -- SCHEMA-QUALIFIED profiles table
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM public.profiles WHERE id = NEW.follower_id;

    -- SCHEMA-QUALIFIED function call
    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'new_follower',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' started following you',
      p_action_url := '/athlete/' || NEW.follower_id,
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE TRIGGER trigger_notify_new_follower
  AFTER INSERT ON public.follows
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION public.notify_new_follower();

-- =====================================================
-- SECTION 4: VERIFICATION
-- =====================================================

DO $$
DECLARE
  v_trigger_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'follows'
    AND t.tgname LIKE '%notify%';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FIX COMPLETE!';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed triggers on follows table: %', v_trigger_count;
  RAISE NOTICE '';
  RAISE NOTICE 'All follow triggers now use:';
  RAISE NOTICE '  ✓ public.profiles (schema-qualified)';
  RAISE NOTICE '  ✓ public.notifications (schema-qualified)';
  RAISE NOTICE '  ✓ public.create_notification (schema-qualified)';
  RAISE NOTICE '  ✓ SET search_path = '''' (secure)';
  RAISE NOTICE '';
  RAISE NOTICE 'You should now be able to:';
  RAISE NOTICE '  ✓ Send follow requests to private accounts';
  RAISE NOTICE '  ✓ Follow public accounts';
  RAISE NOTICE '  ✓ Receive notifications for both types';
  RAISE NOTICE '';
END $$;

SELECT '✓ Follow request functionality restored!' AS status;
