-- =====================================================
-- NOTIFICATION ACTIONS SYSTEM
-- =====================================================
-- Adds action tracking to notifications for follow requests
-- and other actionable notifications

-- =====================================================
-- PART 1: ADD ACTION TRACKING COLUMNS
-- =====================================================

-- Add action_status column to track notification lifecycle
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS action_status TEXT CHECK (action_status IN ('pending', 'accepted', 'declined'));

-- Add timestamp for when action was taken
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS action_taken_at TIMESTAMP WITH TIME ZONE;

-- Add grouped_notification_id for future notification grouping feature
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS grouped_notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL;

-- Create index for action status queries
CREATE INDEX IF NOT EXISTS idx_notifications_action_status ON notifications(action_status) WHERE action_status IS NOT NULL;

-- Create index for grouped notifications
CREATE INDEX IF NOT EXISTS idx_notifications_grouped ON notifications(grouped_notification_id) WHERE grouped_notification_id IS NOT NULL;

-- =====================================================
-- PART 2: UPDATE FOLLOW REQUEST TRIGGER
-- =====================================================

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows CASCADE;
DROP FUNCTION IF EXISTS notify_follow_request() CASCADE;

-- Recreate with action_status support
CREATE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM public.profiles WHERE id = NEW.follower_id;

    PERFORM create_notification(
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
-- PART 3: UPDATE FOLLOW ACCEPTED TRIGGER
-- =====================================================

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows CASCADE;
DROP FUNCTION IF EXISTS notify_follow_accepted() CASCADE;

-- Recreate with notification status update
CREATE FUNCTION notify_follow_accepted()
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

    PERFORM create_notification(
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
-- PART 4: CREATE FOLLOW DECLINED TRIGGER
-- =====================================================

-- Create function to handle follow request deletion (decline)
CREATE OR REPLACE FUNCTION notify_follow_declined()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the follow_request notification status when request is deleted
  IF OLD.status = 'pending' THEN
    UPDATE public.notifications
    SET action_status = 'declined',
        action_taken_at = NOW()
    WHERE follow_id = OLD.id
      AND type = 'follow_request';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE TRIGGER trigger_notify_follow_declined
  BEFORE DELETE ON follows
  FOR EACH ROW
  WHEN (OLD.status = 'pending')
  EXECUTE FUNCTION notify_follow_declined();

-- =====================================================
-- PART 5: SET ACTION_STATUS FOR FOLLOW_REQUEST NOTIFICATIONS
-- =====================================================

-- Set action_status = 'pending' for all existing follow_request notifications
-- that don't have a status yet
UPDATE notifications
SET action_status = 'pending'
WHERE type = 'follow_request'
  AND action_status IS NULL
  AND follow_id IN (
    SELECT id FROM follows WHERE status = 'pending'
  );

-- Set action_status = 'accepted' for follow_request notifications
-- where the follow is already accepted
UPDATE notifications
SET action_status = 'accepted',
    action_taken_at = updated_at
WHERE type = 'follow_request'
  AND action_status IS NULL
  AND follow_id IN (
    SELECT id FROM follows WHERE status = 'accepted'
  );

-- =====================================================
-- PART 6: VERIFICATION
-- =====================================================

DO $$
DECLARE
  v_pending_count INTEGER;
  v_accepted_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pending_count
  FROM notifications
  WHERE type = 'follow_request' AND action_status = 'pending';

  SELECT COUNT(*) INTO v_accepted_count
  FROM notifications
  WHERE type = 'follow_request' AND action_status = 'accepted';

  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════════════╗';
  RAISE NOTICE '║   NOTIFICATION ACTIONS SYSTEM COMPLETE! ✓      ║';
  RAISE NOTICE '╚════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'New Columns:';
  RAISE NOTICE '  ✓ action_status (pending | accepted | declined)';
  RAISE NOTICE '  ✓ action_taken_at (timestamp)';
  RAISE NOTICE '  ✓ grouped_notification_id (for future grouping)';
  RAISE NOTICE '';
  RAISE NOTICE 'Updated Triggers:';
  RAISE NOTICE '  ✓ Follow Request - Sets action_status to pending';
  RAISE NOTICE '  ✓ Follow Accepted - Updates notification to accepted';
  RAISE NOTICE '  ✓ Follow Declined - Updates notification to declined';
  RAISE NOTICE '';
  RAISE NOTICE 'Migrated Data:';
  RAISE NOTICE '  • Pending follow requests: %', v_pending_count;
  RAISE NOTICE '  • Accepted follow requests: %', v_accepted_count;
  RAISE NOTICE '';
END $$;
