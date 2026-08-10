-- ============================================================================
-- Migration 075 — reposts: posts.shared_post_id + cached reposts_count
-- ============================================================================
-- WHAT (three things):
--   (a) posts.shared_post_id UUID → posts(id) ON DELETE SET NULL — a repost
--       is a normal posts row (caption optional) that points at the ORIGINAL
--       post. FK shape copied verbatim from messages.shared_post_id (012);
--       self-FK + SET NULL precedent: notifications.grouped_notification_id
--       (009). SET NULL so a repost SURVIVES its original's deletion and
--       renders a "post unavailable" placeholder. Partial index shipped WITH
--       the column (the 072/074 lesson: never leave an FK unindexed).
--   (b) posts.reposts_count — cached count on the ORIGINAL, maintained by an
--       absolute-recount trigger (the 015 pattern). Unlike likes/comments,
--       the source table IS posts itself, keyed on shared_post_id.
--   (c) One-time idempotent backfill recount (a no-op on first run — no
--       reposts can exist before this migration).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   • NO RPC changes. 074's four profile-media functions are untouched: a
--     repost row satisfies the STATEMENT predicate BY CONSTRUCTION (no
--     stats/round/group/media), which 074's header pre-authorized. The
--     Statements rail hydrates the quoted original app-layer, the same
--     re-query trick the media route already uses for group_post_id.
--   • NO notifications changes. Product decision: no repost notification,
--     so notifications_type_check is not touched.
--   • NO CHECK forbidding repost+media — a CHECK cannot reference post_media
--     anyway; the app layer rejects media/golf/stats on repost creation
--     (consistent with posts_insert_policy checking authorship only; the
--     service-role API routes bypass RLS and enforce app-layer).
--   • NO uniqueness constraint — multiple reposts of one post by one user
--     are allowed; undo is deleting your repost.
--
-- TRIGGER REASONING (document once, here):
--   • Every ordinary post INSERT passes through the trigger; when
--     NEW.shared_post_id IS NULL it returns immediately — a cheap no-op.
--   • Deleting an ORIGINAL fires the FK's ON DELETE SET NULL, which is an
--     UPDATE of shared_post_id on each surviving repost. The UPDATE arm
--     recounts OLD.shared_post_id — a row that is mid-delete — so the
--     recount UPDATE matches 0 rows. Harmless by design.
--   • No recursion: the recount writes ONLY reposts_count, and the trigger's
--     UPDATE arm is scoped UPDATE OF shared_post_id, so recounts never
--     re-fire the trigger. Deleting a repost fires the DELETE arm once.
--
-- ORDER OF OPERATIONS: run BEFORE the app deploy that adds the Repost UI —
-- the INVERSE of 074, because the failure modes invert. With the column live
-- under the old app, every transform whitelist simply drops the new fields
-- and the trigger no-ops (fully soft). With the new app but no column, every
-- repost submit 500s on a missing column (hard, user-visible).
--
-- PRE-FLIGHT (expect: 0 rows from each):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'posts' AND column_name IN ('shared_post_id', 'reposts_count');
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'posts' AND indexname = 'idx_posts_shared_post_id';
-- (Note: check_golf_sources may exist from an archived legacy script —
--  unaffected; reposts carry NULL round_id/group_post_id.)
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

-- ── (a) column + index ──────────────────────────────────────────────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS
  shared_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS
  reposts_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_posts_shared_post_id
  ON posts (shared_post_id)
  WHERE shared_post_id IS NOT NULL;

-- ── (b) recount trigger (015 pattern; source table is posts itself) ─────────
CREATE OR REPLACE FUNCTION update_post_reposts_count()
RETURNS TRIGGER AS $$
DECLARE
  old_target UUID;
  new_target UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_target := NEW.shared_post_id;
  ELSIF TG_OP = 'DELETE' THEN
    old_target := OLD.shared_post_id;
  ELSE -- UPDATE OF shared_post_id
    IF OLD.shared_post_id IS DISTINCT FROM NEW.shared_post_id THEN
      old_target := OLD.shared_post_id;
      new_target := NEW.shared_post_id;
    END IF;
  END IF;

  IF old_target IS NOT NULL THEN
    UPDATE public.posts
    SET reposts_count = (
      SELECT COUNT(*) FROM public.posts WHERE shared_post_id = old_target
    )
    WHERE id = old_target;
  END IF;

  IF new_target IS NOT NULL THEN
    UPDATE public.posts
    SET reposts_count = (
      SELECT COUNT(*) FROM public.posts WHERE shared_post_id = new_target
    )
    WHERE id = new_target;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

DROP TRIGGER IF EXISTS trigger_update_post_reposts_count ON posts;
CREATE TRIGGER trigger_update_post_reposts_count
  AFTER INSERT OR DELETE OR UPDATE OF shared_post_id ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_post_reposts_count();

-- ── (c) idempotent backfill (no-op on first run) ────────────────────────────
UPDATE posts p
SET reposts_count = sub.actual
FROM (
  SELECT p2.id, COUNT(c.id) AS actual
  FROM posts p2
  LEFT JOIN posts c ON c.shared_post_id = p2.id
  GROUP BY p2.id
) sub
WHERE sub.id = p.id AND p.reposts_count IS DISTINCT FROM sub.actual;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Columns present (expect 2 rows):
--      SELECT column_name, data_type FROM information_schema.columns
--      WHERE table_name = 'posts'
--        AND column_name IN ('shared_post_id', 'reposts_count');
--
-- 2. Index present (expect 1 row):
--      SELECT indexname FROM pg_indexes
--      WHERE tablename = 'posts' AND indexname = 'idx_posts_shared_post_id';
--
-- 3. Trigger present (expect 1 row):
--      SELECT tgname FROM pg_trigger
--      WHERE tgname = 'trigger_update_post_reposts_count';
--
-- 4. FK action is SET NULL (expect confdeltype = 'n'):
--      SELECT conname, confdeltype FROM pg_constraint
--      WHERE conrelid = 'posts'::regclass AND conname LIKE '%shared_post_id%';
--
-- 5. Recount identity — after any reposts exist (expect 0 rows):
--      SELECT p.id, p.reposts_count,
--             (SELECT COUNT(*) FROM posts c WHERE c.shared_post_id = p.id) AS actual
--      FROM posts p
--      WHERE p.reposts_count != (SELECT COUNT(*) FROM posts c WHERE c.shared_post_id = p.id);
--
-- 6. Behavioral (safe on a disposable post pair): insert a repost row →
--    original's reposts_count = 1; delete the repost → back to 0; delete the
--    ORIGINAL with a repost pointing at it → repost survives with
--    shared_post_id NULL and no error (the SET-NULL/UPDATE-arm path).
-- ============================================================================
