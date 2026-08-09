-- Migration 072: index post_comments.parent_comment_id
--
-- WHY: replies-to-replies ship with the nested-comments round. Reply
-- lookups and the ON DELETE CASCADE on the self-FK both walk
-- parent_comment_id; the index existed only in an archived legacy script
-- (database/archive/loose-legacy/fix-missing-fk-indexes.sql), never in a
-- numbered migration, so the live DB has an unindexed self-FK.
--
-- Partial: only reply rows carry a parent, and NULL rows (top-level
-- comments) are the majority.
--
-- RUN ANY TIME relative to the app deploy — the app change is read-path
-- neutral (no new columns referenced); this is purely a performance/
-- cascade-safety index.
--
-- Pre-flight (expect: 0 rows):
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'post_comments' AND indexname = 'idx_post_comments_parent_comment_id';

CREATE INDEX IF NOT EXISTS idx_post_comments_parent_comment_id
  ON post_comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

-- Verify (expect: 1 row):
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'post_comments' AND indexname = 'idx_post_comments_parent_comment_id';
