-- ============================================================================
-- Migration 025 — Fix notify_profile_tagged(): tagging is broken in prod
-- ============================================================================
-- Found by the July 22, 2026 bug hunt and CONFIRMED LIVE: inserting an active
-- post_tags row fails with 42703 `record "new" has no field "tags"`.
--
-- Root cause: the archived hot-fix script fix-trigger-functions-schema.sql
-- redefined notify_profile_tagged() as if it were attached to the POSTS table
-- (reads NEW.tags / NEW.profile_id), but the trigger from migration 008 fires
-- on POST_TAGS (columns: post_id, tagged_profile_id, created_by_profile_id,
-- status). Every active-tag insert therefore errors:
--   - POST /api/tags → 500 (tagging someone fails outright)
--   - POST /api/posts with tagged people → post_tags error is swallowed, so
--     the post is created silently WITHOUT tags or tag notifications.
--
-- This migration recreates the function for the table it actually fires on,
-- delegating to create_notification() (which handles the self-notification
-- guard redundantly, preference gating via tags_enabled, and the title that
-- clients rebuild per migration 014's convention).
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_profile_tagged()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Don't notify if tagging yourself (create_notification also guards this)
  IF NEW.tagged_profile_id = NEW.created_by_profile_id THEN
    RETURN NEW;
  END IF;

  -- Actor display name, same convention as migration 014
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.created_by_profile_id;

  PERFORM public.create_notification(
    p_user_id   := NEW.tagged_profile_id,
    p_type      := 'tag',
    p_actor_id  := NEW.created_by_profile_id,
    p_title     := v_actor_name || ' tagged you in a post',
    p_action_url := '/feed?post=' || NEW.post_id,
    p_post_id   := NEW.post_id,
    p_metadata  := jsonb_build_object('tag_id', NEW.id, 'media_id', NEW.media_id)
  );

  RETURN NEW;
END;
$$;

-- Ensure the trigger exists on post_tags exactly as migration 008 intended
-- (and remove any stray copy on posts, in case a hot-fix attached one there).
DROP TRIGGER IF EXISTS trigger_notify_profile_tagged ON public.posts;
DROP TRIGGER IF EXISTS trigger_notify_profile_tagged ON public.post_tags;
CREATE TRIGGER trigger_notify_profile_tagged
  AFTER INSERT ON public.post_tags
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.notify_profile_tagged();

-- ── Verification (run after) ────────────────────────────────────────────────
-- Insert an active tag between two distinct profiles on an existing post:
--   expect success (no 42703) and a notifications row with type='tag',
--   correct user_id/actor_id, and title '<name> tagged you in a post'.
-- Then delete the test tag + notification.
