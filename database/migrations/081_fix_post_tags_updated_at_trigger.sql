-- ============================================================================
-- Migration 081 — Fix update_post_tags_updated_at(): untagging is broken in prod
-- ============================================================================
-- Found by the August 12, 2026 maintenance sweep and CONFIRMED LIVE against
-- production: ANY UPDATE on post_tags fails with
--   42703  record "new" has no field "tags"
--
-- Probed directly (service role, prod):
--   INSERT status='active'   -> 201 OK
--   INSERT status='removed'  -> 201 OK
--   UPDATE ... status        -> 400  42703 record "new" has no field "tags"
--
-- Root cause — the SAME failure mode as migration 025, from the same family of
-- archived hot-fixes. database/archive/old-migrations/fix-utility-functions-schema.sql
-- redefined update_post_tags_updated_at() as if it were attached to the POSTS
-- table:
--
--   IF NEW.tags IS DISTINCT FROM OLD.tags THEN
--     NEW.updated_at := NOW();
--   END IF;
--
-- post_tags has no `tags` column (its columns are post_id, tagged_profile_id,
-- created_by_profile_id, status, media_id, …), so the BEFORE UPDATE trigger
-- from migration 008 raises on every update. Migration 008's original body did
-- the obvious thing — stamp updated_at unconditionally — and that is what this
-- migration restores.
--
-- User-visible impact while broken:
--   • POST/DELETE /api/tags?tagId=… — a tagged person removing THEMSELF goes
--     through `.update({status:'removed'})` and gets a hard 500
--     ("Failed to remove tag"). They cannot untag themselves.
--   • DELETE /api/tags?postId=… — the status='removed' MARKER upsert hits
--     ON CONFLICT DO UPDATE and fails. The route logs and continues, so the
--     user appears untagged, but the marker never persists — and
--     src/lib/group-posts/mirror-tags.ts reads exactly that marker to keep an
--     untagged participant untagged. A group-round resync therefore RE-TAGS
--     someone who removed themself.
--   • Re-tagging anyone previously removed (upsert conflict) fails the same way.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_post_tags_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Unconditional stamp, as migration 008 intended. Do NOT reintroduce a
  -- column guard here: this function is attached to post_tags, and guarding on
  -- a column that table does not have is the entire bug being fixed.
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- Rebind defensively — the trigger should already exist from migration 008,
-- but recreating it makes this file self-sufficient if 008 drifted.
DROP TRIGGER IF EXISTS trigger_update_post_tags_timestamp ON public.post_tags;
CREATE TRIGGER trigger_update_post_tags_timestamp
  BEFORE UPDATE ON public.post_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_post_tags_updated_at();

-- ============================================================================
-- VERIFICATION — run this block; it must print NOTICE "081 OK" and roll back.
-- It exercises the exact path that was failing (UPDATE on a post_tags row).
-- ============================================================================
DO $$
DECLARE
  v_profile UUID;
  v_other   UUID;
  v_post    UUID;
  v_stamp   TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_profile FROM public.profiles ORDER BY created_at LIMIT 1;
  SELECT id INTO v_other   FROM public.profiles WHERE id <> v_profile ORDER BY created_at LIMIT 1;
  IF v_profile IS NULL OR v_other IS NULL THEN
    RAISE NOTICE '081 SKIPPED verification: needs at least two profiles';
    RETURN;
  END IF;

  INSERT INTO public.posts (profile_id, caption, visibility)
  VALUES (v_profile, '081 verification — rolled back', 'private')
  RETURNING id INTO v_post;

  INSERT INTO public.post_tags (post_id, tagged_profile_id, created_by_profile_id, status)
  VALUES (v_post, v_other, v_profile, 'active');

  -- This is the statement that raised 42703 before the fix.
  UPDATE public.post_tags
     SET status = 'removed'
   WHERE post_id = v_post AND tagged_profile_id = v_other
  RETURNING updated_at INTO v_stamp;

  IF v_stamp IS NULL THEN
    RAISE EXCEPTION '081 FAILED: update did not stamp updated_at';
  END IF;

  RAISE NOTICE '081 OK — post_tags UPDATE succeeded and stamped %', v_stamp;

  -- Leave no trace: the post cascade-deletes its tag rows.
  DELETE FROM public.posts WHERE id = v_post;
END $$;
