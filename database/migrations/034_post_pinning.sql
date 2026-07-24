-- ============================================================================
-- Migration 034 — Pinned "Featured" posts
-- ============================================================================
-- Athletes pin up to 3 of their own posts; they render as a "Featured" row
-- above the media grid on athlete profile pages (own + visitor view).
--
-- Design mirrors comment pinning (016): pin state lives on the row itself
-- (a post has exactly one owner/profile page, so no join table), the cap is
-- enforced at the API level (PATCH /api/posts), and pinned_at DESC is the
-- display order (newest pin first — no display_order column needed).
--
-- No RLS changes: the existing posts row policies already cover the new
-- columns (owner-only update; owner/public/accepted-follower select), so a
-- pinned private post stays invisible to non-followers.
--
-- ⚠️ Run BEFORE deploying the code (ADD COLUMN after deploy → PostgREST
-- 42703 on selects). Inert until the code ships. Idempotent.
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Partial index: a profile's pinned posts in display order
CREATE INDEX IF NOT EXISTS idx_posts_pinned
  ON posts(profile_id, pinned_at DESC) WHERE is_pinned = TRUE;

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT count(*) FROM posts WHERE is_pinned;          → 0 (nothing pinned yet)
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'posts' AND indexname = 'idx_posts_pinned';  → 1 row
