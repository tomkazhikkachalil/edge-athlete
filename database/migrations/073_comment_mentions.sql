-- Migration 073: post_comments.mentions — resolved @mention profile ids
--
-- WHY: @mentions ship for comments. The SERVER derives this column by
-- re-parsing the comment text on POST (extract @handles → resolve → filter
-- to author-taggable: public ∪ author's accepted follows), so it is
-- unforgeable by the client. uuid[] mirrors the posts.tags precedent (one
-- store, read-path hydrated in the comments GET; notifications fan out at
-- POST time from the same resolution — a single source, unlike the
-- posts.tags/post_tags split that once diverged).
--
-- 'mention' notifications need NO schema change: the type is already in the
-- notifications CHECK constraint (003/059), notification_preferences has
-- mentions_enabled DEFAULT true, and the client read side is fully wired.
--
-- RUN BEFORE DEPLOYING the app change (ADD COLUMN before deploy — the new
-- comments INSERT/SELECT reference the column and would 42703 without it).
--
-- Pre-flight (expect: column does not exist):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'post_comments' AND column_name = 'mentions';

ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN post_comments.mentions IS
  'Profile ids @mentioned in content, resolved server-side at POST from the author''s taggable set (public + accepted follows). Render-side, tokens are matched against these profiles'' CURRENT handles — a renamed handle degrades to plain text by design.';

-- Verify (expect: 1 row, data_type ARRAY):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'post_comments' AND column_name = 'mentions';
