-- ============================================================================
-- Migration 090 — Post attribution: who actually wrote it
-- ============================================================================
-- Family console Round 2 (Aug 19 2026), principle 10: "everything the
-- guardian does is done on behalf of". A guardian composing via
-- targetProfileId used to produce a post indistinguishable from the child's
-- own. created_by_user_id records the HUMAN author; it stays NULL for normal
-- self-authored posts (the overwhelmingly common case).
--
-- ON DELETE SET NULL: the attribution is informational — deleting the
-- guardian's account must never take the athlete's post with it.
--
-- ⚠️ DEPLOY ORDER IS STRICT (unlike 089): the app's post reads embed this
-- column, so run this BEFORE merging the attribution PR.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS created_by_user_id uuid
  REFERENCES profiles(id) ON DELETE SET NULL;

-- Partial index: keeps the SET NULL cascade cheap; almost all rows are NULL.
CREATE INDEX IF NOT EXISTS idx_posts_created_by ON posts (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect one row: column_present = true, fk_name = posts_created_by_user_id_fkey
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts'
      AND column_name = 'created_by_user_id'
  ) AS column_present,
  (
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.posts'::regclass
      AND confrelid = 'public.profiles'::regclass
      AND conname <> 'posts_profile_id_fkey'
    LIMIT 1
  ) AS fk_name;
