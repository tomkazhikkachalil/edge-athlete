-- ============================================================================
-- Migration 095 — Comment moderation for supervised athletes
-- ============================================================================
-- Guardian safety round (Aug 20 2026). Supervised children's comments were
-- live-on-insert while the approvals page promised "nothing is visible until
-- you approve". This gives comments the posts pipeline (051's shape): a
-- status lifecycle, a per-athlete guardian toggle, and trigger guards so
-- held comments never inflate counts or notify the post owner early.
--
-- ⚠️ DEPLOY ORDER IS STRICT: the app filters on post_comments.status, so run
-- this BEFORE merging the round's PR. Old code + this migration is safe
-- (inserts default to 'published'; triggers behave identically for
-- published rows).

-- ── 1. Comment lifecycle ─────────────────────────────────────────────────────
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('published', 'pending_approval', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_post_comments_status_pending
  ON post_comments (profile_id)
  WHERE status <> 'published';

-- ── 2. Count trigger: only PUBLISHED comments count ──────────────────────────
-- Body from 015 (with 040's search_path discipline), plus the status filter,
-- plus UPDATE OF status so approve/reject re-syncs the cached count.
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
    SELECT COUNT(*) FROM public.post_comments
    WHERE post_id = target_post_id AND status = 'published'
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
  AFTER INSERT OR DELETE OR UPDATE OF status ON post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comments_count();

-- ── 3. Post-owner notification: never for held comments ──────────────────────
-- Body is the CURRENTLY DEPLOYED one (014's actor-name version), with one
-- added guard. The app fires this notification itself on approval.
DROP TRIGGER IF EXISTS trigger_notify_post_comment ON post_comments CASCADE;
DROP FUNCTION IF EXISTS notify_post_comment() CASCADE;

CREATE FUNCTION notify_post_comment()
RETURNS TRIGGER AS $t$
DECLARE
  v_post_owner UUID;
  v_actor_name TEXT;
BEGIN
  -- Held/rejected comments are invisible: no notification until approval
  -- (the app sends it when a guardian approves).
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

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

CREATE TRIGGER trigger_notify_post_comment
  AFTER INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION notify_post_comment();

-- ── 4. The guardian toggle ───────────────────────────────────────────────────
-- Only ever consulted for SUPERVISED authors (adults are never gated).
-- 'held' default = supervised children start moderated, consistent with
-- posts (always held); guardians relax to 'instant' per athlete.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS comment_moderation TEXT NOT NULL DEFAULT 'held'
  CHECK (comment_moderation IN ('instant', 'held'));

-- ── 5. Notification types for the comment queue ──────────────────────────────
-- Full-list re-ADD, the 028/053/059/089 house pattern. Base list = 089's
-- live list (the LAST migration to touch this constraint) + the two new
-- comment types.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result'
  ));

-- ── 6. Audit trail covers the new field (091's inline CHECK is auto-named) ───
ALTER TABLE safety_settings_audit DROP CONSTRAINT IF EXISTS safety_settings_audit_field_check;
ALTER TABLE safety_settings_audit ADD CONSTRAINT safety_settings_audit_field_check
  CHECK (field IN ('visibility', 'messaging_permission', 'comment_moderation'));

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect: every column true.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'post_comments' AND column_name = 'status') AS status_column,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'profiles' AND column_name = 'comment_moderation') AS toggle_column,
  (SELECT pg_get_functiondef('public.update_post_comments_count()'::regprocedure)
     LIKE '%status = ''published''%') AS count_fn_filters,
  (SELECT pg_get_functiondef('public.notify_post_comment()'::regprocedure)
     LIKE '%NEW.status <> ''published''%') AS notify_fn_guards,
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgname = 'trigger_update_post_comments_count' AND NOT tgisinternal
            AND tgtype::int & 16 = 16) AS count_trigger_fires_on_update,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'safety_settings_audit_field_check')
     LIKE '%comment_moderation%' AS audit_check_extended,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check')
     LIKE '%comment_pending_approval%' AS notification_types_extended;
