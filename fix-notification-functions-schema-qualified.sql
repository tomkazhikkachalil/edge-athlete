-- =====================================================
-- FIX NOTIFICATION FUNCTIONS WITH SCHEMA-QUALIFIED NAMES
-- =====================================================
-- Purpose: Fix broken notification triggers after search_path = '' change
-- Issue: Notification functions reference tables without schema prefix
-- Solution: Update all functions to use public.table_name
-- Impact: Restores follow functionality and other notification triggers
-- Version: 1.0
-- Created: 2025-01-15
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FIXING NOTIFICATION FUNCTIONS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Updating all functions to use schema-qualified table names';
  RAISE NOTICE 'This fixes the issue caused by setting search_path = ''''';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- SECTION 1: DROP OLD TRIGGERS
-- =====================================================

DROP TRIGGER IF EXISTS trigger_notify_follow_request ON public.follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON public.follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON public.follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_post_like ON public.post_likes CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_post_comment ON public.post_comments CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_comment_like ON public.comment_likes CASCADE;

-- =====================================================
-- SECTION 2: RECREATE HELPER FUNCTION (SCHEMA-QUALIFIED)
-- =====================================================

DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, JSONB) CASCADE;

CREATE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_actor_id UUID,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_action_url TEXT DEFAULT NULL,
  p_post_id UUID DEFAULT NULL,
  p_comment_id UUID DEFAULT NULL,
  p_follow_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
  v_preferences RECORD;
BEGIN
  -- Don't notify self
  IF p_actor_id = p_user_id THEN RETURN NULL; END IF;

  -- Get or create preferences (SCHEMA-QUALIFIED)
  SELECT * INTO v_preferences
  FROM public.notification_preferences
  WHERE user_id = p_user_id;

  IF v_preferences IS NULL THEN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;

  -- Check if notification type is enabled
  IF (
    (p_type = 'follow_request' AND v_preferences.follow_requests_enabled) OR
    (p_type = 'follow_accepted' AND v_preferences.follow_accepted_enabled) OR
    (p_type = 'new_follower' AND v_preferences.new_followers_enabled) OR
    (p_type = 'like' AND v_preferences.likes_enabled) OR
    (p_type = 'comment' AND v_preferences.comments_enabled) OR
    (p_type = 'mention' AND v_preferences.mentions_enabled) OR
    (p_type = 'tag' AND v_preferences.tags_enabled) OR
    (p_type = 'achievement' AND v_preferences.achievements_enabled) OR
    (p_type = 'system_announcement' AND v_preferences.system_announcements_enabled) OR
    (p_type = 'club_update' AND v_preferences.club_updates_enabled)
  ) THEN
    INSERT INTO public.notifications (
      user_id, type, actor_id, title, message, action_url,
      post_id, comment_id, follow_id, metadata
    ) VALUES (
      p_user_id, p_type, p_actor_id, p_title, p_message, p_action_url,
      p_post_id, p_comment_id, p_follow_id, p_metadata
    )
    RETURNING id INTO v_notification_id;
    RETURN v_notification_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- SECTION 3: FOLLOW NOTIFICATION FUNCTIONS (SCHEMA-QUALIFIED)
-- =====================================================

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

    -- SCHEMA-QUALIFIED function call
    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'follow_request',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' sent you a follow request',
      p_message := NEW.message,
      p_action_url := '/app/followers?tab=requests',
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP FUNCTION IF EXISTS public.notify_follow_accepted() CASCADE;

CREATE FUNCTION public.notify_follow_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    -- SCHEMA-QUALIFIED profiles table
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- SECTION 4: POST LIKE NOTIFICATION FUNCTION (SCHEMA-QUALIFIED)
-- =====================================================

DROP FUNCTION IF EXISTS public.notify_post_like() CASCADE;

CREATE FUNCTION public.notify_post_like()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_post_author UUID;
BEGIN
  -- SCHEMA-QUALIFIED posts table
  SELECT profile_id INTO v_post_author FROM public.posts WHERE id = NEW.post_id;
  IF v_post_author = NEW.profile_id THEN RETURN NEW; END IF;

  -- SCHEMA-QUALIFIED profiles table
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name FROM public.profiles WHERE id = NEW.profile_id;

  -- SCHEMA-QUALIFIED function call
  PERFORM public.create_notification(
    p_user_id := v_post_author,
    p_type := 'like',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' liked your post',
    p_action_url := '/feed?post=' || NEW.post_id,
    p_post_id := NEW.post_id,
    p_metadata := jsonb_build_object('post_id', NEW.post_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- SECTION 5: COMMENT NOTIFICATION FUNCTION (SCHEMA-QUALIFIED)
-- =====================================================

DROP FUNCTION IF EXISTS public.notify_post_comment() CASCADE;

CREATE FUNCTION public.notify_post_comment()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_post_author UUID;
  v_comment_preview TEXT;
BEGIN
  -- SCHEMA-QUALIFIED posts table
  SELECT profile_id INTO v_post_author FROM public.posts WHERE id = NEW.post_id;
  IF v_post_author = NEW.profile_id THEN RETURN NEW; END IF;

  -- SCHEMA-QUALIFIED profiles table
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name FROM public.profiles WHERE id = NEW.profile_id;

  v_comment_preview := SUBSTRING(NEW.content FROM 1 FOR 100);
  IF LENGTH(NEW.content) > 100 THEN
    v_comment_preview := v_comment_preview || '...';
  END IF;

  -- SCHEMA-QUALIFIED function call
  PERFORM public.create_notification(
    p_user_id := v_post_author,
    p_type := 'comment',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' commented on your post',
    p_message := v_comment_preview,
    p_action_url := '/feed?post=' || NEW.post_id || '#comment-' || NEW.id,
    p_post_id := NEW.post_id,
    p_comment_id := NEW.id,
    p_metadata := jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- SECTION 6: COMMENT LIKE NOTIFICATION (if exists)
-- =====================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'comment_likes') THEN
    DROP FUNCTION IF EXISTS public.notify_comment_like() CASCADE;

    EXECUTE '
      CREATE FUNCTION public.notify_comment_like()
      RETURNS TRIGGER AS $func$
      DECLARE
        v_actor_name TEXT;
        v_comment_author UUID;
      BEGIN
        -- SCHEMA-QUALIFIED post_comments table
        SELECT profile_id INTO v_comment_author FROM public.post_comments WHERE id = NEW.comment_id;
        IF v_comment_author = NEW.profile_id THEN RETURN NEW; END IF;

        -- SCHEMA-QUALIFIED profiles table
        SELECT COALESCE(first_name || '' '' || last_name, full_name, ''Someone'')
        INTO v_actor_name FROM public.profiles WHERE id = NEW.profile_id;

        -- SCHEMA-QUALIFIED function call
        PERFORM public.create_notification(
          p_user_id := v_comment_author,
          p_type := ''like'',
          p_actor_id := NEW.profile_id,
          p_title := v_actor_name || '' liked your comment'',
          p_action_url := ''/feed?comment='' || NEW.comment_id,
          p_comment_id := NEW.comment_id,
          p_metadata := jsonb_build_object(''comment_id'', NEW.comment_id)
        );
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '''';
    ';

    RAISE NOTICE '✓ Fixed: notify_comment_like';
  END IF;
END $$;

-- =====================================================
-- SECTION 7: CLEANUP FUNCTION (SCHEMA-QUALIFIED)
-- =====================================================

DROP FUNCTION IF EXISTS public.cleanup_old_notifications() CASCADE;

CREATE FUNCTION public.cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- SCHEMA-QUALIFIED notifications table
  DELETE FROM public.notifications
  WHERE is_read = true AND read_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- SECTION 8: RECREATE ALL TRIGGERS
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Recreating triggers...';
  RAISE NOTICE '';
END $$;

CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_follow_request();

CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_follow_accepted();

CREATE TRIGGER trigger_notify_new_follower
  AFTER INSERT ON public.follows
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION public.notify_new_follower();

-- Post likes trigger (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'post_likes') THEN
    EXECUTE '
      CREATE TRIGGER trigger_notify_post_like
        AFTER INSERT ON public.post_likes
        FOR EACH ROW
        EXECUTE FUNCTION public.notify_post_like();
    ';
    RAISE NOTICE '✓ Created trigger: trigger_notify_post_like';
  END IF;
END $$;

-- Comments trigger (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'post_comments') THEN
    EXECUTE '
      CREATE TRIGGER trigger_notify_post_comment
        AFTER INSERT ON public.post_comments
        FOR EACH ROW
        EXECUTE FUNCTION public.notify_post_comment();
    ';
    RAISE NOTICE '✓ Created trigger: trigger_notify_post_comment';
  END IF;
END $$;

-- Comment likes trigger (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'comment_likes') THEN
    EXECUTE '
      CREATE TRIGGER trigger_notify_comment_like
        AFTER INSERT ON public.comment_likes
        FOR EACH ROW
        EXECUTE FUNCTION public.notify_comment_like();
    ';
    RAISE NOTICE '✓ Created trigger: trigger_notify_comment_like';
  END IF;
END $$;

-- =====================================================
-- SECTION 9: VERIFICATION
-- =====================================================

DO $$
DECLARE
  v_function_count INTEGER;
  v_trigger_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname LIKE '%notify%';

  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgname LIKE '%notify%';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    NOTIFICATION FUNCTIONS FIXED!';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions fixed: %', v_function_count;
  RAISE NOTICE 'Triggers recreated: %', v_trigger_count;
  RAISE NOTICE '';
  RAISE NOTICE 'All functions now use:';
  RAISE NOTICE '  ✓ public.profiles (schema-qualified)';
  RAISE NOTICE '  ✓ public.posts (schema-qualified)';
  RAISE NOTICE '  ✓ public.notifications (schema-qualified)';
  RAISE NOTICE '  ✓ public.notification_preferences (schema-qualified)';
  RAISE NOTICE '  ✓ SET search_path = '''' (secure)';
  RAISE NOTICE '';
  RAISE NOTICE 'Follow button should now work!';
  RAISE NOTICE '';
END $$;

SELECT '✓ Notification functions fixed with schema-qualified names!' AS status;
SELECT '✓ Follow functionality restored!' AS result;
SELECT '✓ Test the follow button in your app now!' AS next_step;
