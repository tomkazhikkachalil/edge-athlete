-- ============================================================================
-- Migration 093 — Comment attribution: who actually wrote it
-- ============================================================================
-- Guardian Round 5 (Aug 20 2026). Same shape as 090 for posts: a guardian
-- commenting via targetProfileId records the HUMAN author; NULL for normal
-- self-authored comments. ON DELETE SET NULL — attribution is informational,
-- deleting the guardian's account never takes the athlete's comment.
--
-- ⚠️ DEPLOY ORDER IS STRICT (like 090, unlike 089/092): the comments GET
-- embeds this column, so run this BEFORE merging the round's PR.

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS created_by_user_id uuid
  REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comments_created_by
  ON post_comments (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check (run separately if pasting mangles quotes) ─────────────
-- Expect: column_present = true
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'post_comments'
    AND column_name = 'created_by_user_id'
) AS column_present;
