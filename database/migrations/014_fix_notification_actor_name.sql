-- =====================================================
-- FIX: Notification trigger actor name format
-- =====================================================
-- Problem: COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
-- returns NULL if EITHER first_name or last_name is NULL (PostgreSQL
-- NULL concatenation), falling back to full_name which may be a handle
-- like "JohnDoe" instead of the display name.
--
-- Fix: Use COALESCE on each name part individually, then TRIM and NULLIF
-- to handle all combinations gracefully.
-- =====================================================

-- Helper: robust actor name lookup
-- Returns: "First Last" if both set, "First" if only first, full_name as fallback, else 'Someone'
CREATE OR REPLACE FUNCTION get_actor_display_name(p_profile_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT COALESCE(
    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
    full_name,
    'Someone'
  )
  INTO v_name
  FROM public.profiles
  WHERE id = p_profile_id;

  RETURN COALESCE(v_name, 'Someone');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

-- =====================================================
-- Update follow request trigger
-- =====================================================
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows CASCADE;
DROP FUNCTION IF EXISTS notify_follow_request() CASCADE;

CREATE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    v_actor_name := public.get_actor_display_name(NEW.follower_id);

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
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_request();

-- =====================================================
-- Update follow accepted trigger
-- =====================================================
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows CASCADE;
DROP FUNCTION IF EXISTS notify_follow_accepted() CASCADE;

CREATE FUNCTION notify_follow_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    v_actor_name := public.get_actor_display_name(NEW.following_id);

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
  AFTER UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_accepted();

-- =====================================================
-- Update new follower trigger
-- =====================================================
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON follows CASCADE;
DROP FUNCTION IF EXISTS notify_new_follower() CASCADE;

CREATE FUNCTION notify_new_follower()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'accepted' THEN
    v_actor_name := public.get_actor_display_name(NEW.follower_id);

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
  AFTER INSERT ON follows
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION notify_new_follower();

-- =====================================================
-- Update post like trigger (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_likes') THEN
    DROP TRIGGER IF EXISTS trigger_notify_post_like ON post_likes CASCADE;
    DROP FUNCTION IF EXISTS notify_post_like() CASCADE;

    EXECUTE $func$
    CREATE FUNCTION notify_post_like()
    RETURNS TRIGGER AS $t$
    DECLARE
      v_post_owner UUID;
      v_actor_name TEXT;
    BEGIN
      SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
      IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
        RETURN NEW;
      END IF;

      v_actor_name := public.get_actor_display_name(NEW.profile_id);

      PERFORM public.create_notification(
        p_user_id := v_post_owner,
        p_type := 'like',
        p_actor_id := NEW.profile_id,
        p_title := v_actor_name || ' liked your post',
        p_action_url := '/feed',
        p_post_id := NEW.post_id,
        p_metadata := jsonb_build_object('post_id', NEW.post_id)
      );
      RETURN NEW;
    END;
    $t$ LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = '';
    $func$;

    EXECUTE 'CREATE TRIGGER trigger_notify_post_like AFTER INSERT ON post_likes FOR EACH ROW EXECUTE FUNCTION notify_post_like()';
  END IF;
END $$;

-- =====================================================
-- Update post comment trigger (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_comments') THEN
    DROP TRIGGER IF EXISTS trigger_notify_post_comment ON post_comments CASCADE;
    DROP FUNCTION IF EXISTS notify_post_comment() CASCADE;

    EXECUTE $func$
    CREATE FUNCTION notify_post_comment()
    RETURNS TRIGGER AS $t$
    DECLARE
      v_post_owner UUID;
      v_actor_name TEXT;
    BEGIN
      SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
      IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
        RETURN NEW;
      END IF;

      v_actor_name := public.get_actor_display_name(NEW.profile_id);

      PERFORM public.create_notification(
        p_user_id := v_post_owner,
        p_type := 'comment',
        p_actor_id := NEW.profile_id,
        p_title := v_actor_name || ' commented on your post',
        p_action_url := '/feed',
        p_post_id := NEW.post_id,
        p_comment_id := NEW.id,
        p_metadata := jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id)
      );
      RETURN NEW;
    END;
    $t$ LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = '';
    $func$;

    EXECUTE 'CREATE TRIGGER trigger_notify_post_comment AFTER INSERT ON post_comments FOR EACH ROW EXECUTE FUNCTION notify_post_comment()';
  END IF;
END $$;
