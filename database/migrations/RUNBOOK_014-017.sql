-- ============================================================================
-- RUNBOOK: Apply Migrations 014-017 to Supabase
-- ============================================================================
-- Copy-paste this entire file into the Supabase SQL Editor and click Run.
-- (Or paste each STEP section individually if you want to verify between steps.)
--
-- All four migrations are IDEMPOTENT (use IF NOT EXISTS / OR REPLACE / DROP IF
-- EXISTS), so re-running this file is safe.
--
-- For human-readable docs (what each migration does, smoke tests, rollback
-- notes), see RUNBOOK_014-017.md in this same folder.
-- ============================================================================


-- ============================================================================
-- STEP 0: At-a-glance status check (run this any time to see progress)
-- ============================================================================
-- Expected BEFORE this runbook: all four columns = false
-- Expected AFTER this runbook:  all four columns = true

SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS m014_applied,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS m015_applied,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS m016_applied,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS m017_applied;


-- ============================================================================
-- STEP 1: MIGRATION 014 — Fix notification actor name format
-- ============================================================================
-- Replaces 5 trigger functions so notifications show real first/last names
-- (instead of falling back to handle-style full_name when one part is null).

-- 1a. PRE-CHECK (expect helper_exists = false)
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS helper_exists_before;


-- 1b. APPLY MIGRATION 014

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


-- 1c. POST-CHECK (expect all six columns = true)
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS helper_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_follow_request' AND NOT tgisinternal
  ) AS follow_request_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_follow_accepted' AND NOT tgisinternal
  ) AS follow_accepted_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_new_follower' AND NOT tgisinternal
  ) AS new_follower_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_post_like' AND NOT tgisinternal
  ) AS post_like_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_post_comment' AND NOT tgisinternal
  ) AS post_comment_trigger;


-- ============================================================================
-- STEP 2: MIGRATION 015 — Like / comment count triggers + one-time recount
-- ============================================================================
-- Adds triggers that keep posts.likes_count / posts.comments_count in sync
-- with actual rows in post_likes / post_comments. Also runs a one-time
-- recount that fixes any drift in existing posts.

-- 2a. PRE-CHECK (expect both = false)
SELECT
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS likes_trigger_before,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_comments_count' AND NOT tgisinternal
  ) AS comments_trigger_before;


-- 2b. APPLY MIGRATION 015

CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET likes_count = (
    SELECT COUNT(*) FROM public.post_likes WHERE post_id = target_post_id
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

DROP TRIGGER IF EXISTS trigger_update_post_likes_count ON post_likes;
CREATE TRIGGER trigger_update_post_likes_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_post_likes_count();


CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET comments_count = (
    SELECT COUNT(*) FROM public.post_comments WHERE post_id = target_post_id
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

DROP TRIGGER IF EXISTS trigger_update_post_comments_count ON post_comments;
CREATE TRIGGER trigger_update_post_comments_count
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comments_count();


-- One-time recount to fix any existing drift
UPDATE public.posts
SET likes_count = (
  SELECT COUNT(*) FROM public.post_likes WHERE post_likes.post_id = posts.id
);

UPDATE public.posts
SET comments_count = (
  SELECT COUNT(*) FROM public.post_comments WHERE post_comments.post_id = posts.id
);


-- 2c. POST-CHECK (expect all four columns = true)
SELECT
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS likes_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_comments_count' AND NOT tgisinternal
  ) AS comments_trigger,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_post_likes_count')
    AS likes_function,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_post_comments_count')
    AS comments_function;


-- 2d. POST-CHECK drift fixer (expect both = 0)
SELECT
  (SELECT COUNT(*) FROM public.posts p
   WHERE p.likes_count <> (SELECT COUNT(*) FROM public.post_likes WHERE post_id = p.id))
    AS posts_with_stale_likes_count,
  (SELECT COUNT(*) FROM public.posts p
   WHERE p.comments_count <> (SELECT COUNT(*) FROM public.post_comments WHERE post_id = p.id))
    AS posts_with_stale_comments_count;


-- ============================================================================
-- STEP 3: MIGRATION 016 — Comment pinning
-- ============================================================================
-- Adds is_pinned BOOLEAN to post_comments + partial index for fast lookup.

-- 3a. PRE-CHECK (expect both = false)
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS column_exists_before,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_post_comments_is_pinned'
  ) AS index_exists_before;


-- 3b. APPLY MIGRATION 016

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_post_comments_is_pinned
  ON post_comments(post_id) WHERE is_pinned = TRUE;


-- 3c. POST-CHECK (expect both = true)
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS column_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_post_comments_is_pinned'
  ) AS index_exists;


-- ============================================================================
-- STEP 4: MIGRATION 017 — Message reactions schema
-- ============================================================================
-- Adds parent_message_id + 'gif_reaction' type to messages, plus indexes.
-- IMPORTANT: requires 012_messaging.sql to be applied first.

-- 4a. PREREQUISITE CHECK (both must be true — if false, apply 012_messaging.sql first)
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'messages'
  ) AS messages_table_exists,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'message_reactions'
  ) AS message_reactions_table_exists;


-- 4b. PRE-CHECK (expect first three = false; type_check should NOT contain 'gif_reaction')
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS parent_col_exists_before,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_messages_parent'
  ) AS parent_index_exists_before,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_message_reactions_message'
  ) AS reactions_index_exists_before,
  (SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conname = 'messages_type_check')
    AS current_type_check_before;


-- 4c. APPLY MIGRATION 017

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'shared_post', 'shared_profile', 'gif_reaction'));

CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON messages(parent_message_id)
  WHERE parent_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id);


-- 4d. POST-CHECK (expect all three = true; type_check_def should now contain 'gif_reaction')
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS parent_col_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_messages_parent'
  ) AS parent_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_message_reactions_message'
  ) AS reactions_index_exists,
  (SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conname = 'messages_type_check')
    AS type_check_def;


-- ============================================================================
-- STEP 5: Final at-a-glance status (expect all four = true)
-- ============================================================================

SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS m014_applied,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS m015_applied,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS m016_applied,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS m017_applied;
