-- ============================================================================
-- 129: send back with a note — changes_requested status (Family Console W2)
-- ============================================================================
-- Guardian review used to be binary: approve, or a TERMINAL reject. The only
-- "fix it and try again" path was the media-swap re-queue. This migration adds
-- the middle path the console needed:
--
--   * status = 'changes_requested'  =  the guardian sent the item back. The
--     ball is in the CHILD's court: guardian pending lists keep filtering
--     eq 'pending_approval' (a sent-back item must not look actionable), the
--     console queue shows it as a muted "waiting on their edit" row, and the
--     author sees a banner with the guardian's note + an Edit-and-resend CTA.
--   * review_note  =  the guardian's note, set with the send-back and CLEARED
--     on resubmit (posts: PUT /api/posts flips status back to pending_approval;
--     comments: the new scoped 'edit' PATCH action — author-only, only from
--     changes_requested, so published comments stay immutable).
--   * approval_nudged_at  =  48h-nudge dedupe stamp (cron/daily phase 6, PR 3
--     of this wave): pending items older than 48h re-bell the guardians ONCE,
--     then are stamped. Never auto-publishes — the nudge writes no status.
--
-- Both status CHECKs are the inline auto-named constraints from 051/095; this
-- is the house full-list re-ADD (028/053/059/089/095 pattern). The existing
-- partial indexes (WHERE status <> 'published') already cover the new value.
-- 095's count/notify triggers filter on 'published', so changes_requested
-- behaves exactly like pending_approval for counts and notifications.
-- ============================================================================

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('published', 'pending_approval', 'rejected', 'changes_requested'));

ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_status_check;
ALTER TABLE post_comments ADD CONSTRAINT post_comments_status_check
  CHECK (status IN ('published', 'pending_approval', 'rejected', 'changes_requested'));

ALTER TABLE posts         ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE posts         ADD COLUMN IF NOT EXISTS approval_nudged_at TIMESTAMPTZ;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS approval_nudged_at TIMESTAMPTZ;

-- The 48h-nudge sweep reads: pending, older than the threshold, not yet
-- nudged (mirrors 128's partial-index shape).
CREATE INDEX IF NOT EXISTS idx_posts_pending_nudge
  ON posts (created_at)
  WHERE status = 'pending_approval' AND approval_nudged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_pending_nudge
  ON post_comments (created_at)
  WHERE status = 'pending_approval' AND approval_nudged_at IS NULL;

COMMENT ON COLUMN posts.review_note IS
  'Guardian send-back note (129). Set with status=changes_requested; cleared when the author resubmits.';
COMMENT ON COLUMN post_comments.review_note IS
  'Guardian send-back note (129). Set with status=changes_requested; cleared when the author resubmits via the scoped edit action.';
COMMENT ON COLUMN posts.approval_nudged_at IS
  '48h approval-nudge dedupe stamp (129). Non-null = guardians were re-belled once for this pending item.';
COMMENT ON COLUMN post_comments.approval_nudged_at IS
  '48h approval-nudge dedupe stamp (129). Non-null = guardians were re-belled once for this pending item.';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'posts_status_check' AND conrelid = 'posts'::regclass)
    LIKE '%changes_requested%'                                                        AS posts_check,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'post_comments_status_check' AND conrelid = 'post_comments'::regclass)
    LIKE '%changes_requested%'                                                        AS comments_check,
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_name = 'posts' AND column_name = 'review_note')                      AS posts_note,
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_name = 'post_comments' AND column_name = 'review_note')              AS comments_note,
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_name = 'posts' AND column_name = 'approval_nudged_at')               AS posts_nudge,
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_name = 'post_comments' AND column_name = 'approval_nudged_at')       AS comments_nudge,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_posts_pending_nudge')       AS posts_idx,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_post_comments_pending_nudge') AS comments_idx;
