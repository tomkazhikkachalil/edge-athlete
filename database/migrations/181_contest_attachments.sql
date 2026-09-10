-- ============================================================================
-- 181: contest attachments — posts and live rounds attach to their contest
-- ============================================================================
-- Contest Place E2. A contest is a place now (/event/[contestId], E1), and
-- the things people made AT it — the posted round, the shared live round —
-- were only reachable through the golf sync's `payload.roundRef` inside
-- contest_results: un-indexed, un-FK'd, invisible to the feed. Two columns
-- make the attachment first-class:
--
--   posts.contest_id        the post's counted contest (through its round)
--   group_posts.contest_id  the live round's counted contest
--
-- Written by ONE writer: the golf sync (stampContestAttachments, after the
-- results upsert) keeps "attached to this contest" ≡ "the rounds its
-- current results reference" — a replaced round's post detaches. No client
-- ever sets these (the posts POST does not accept them). SET NULL on
-- contest deletion: a deleted round never takes the athlete's post with it
-- (the 134 event_id precedent).
--
-- Backfill in the same file, idempotent: every existing result's roundRef
-- stamps its round's post and its group post. Re-runnable end to end.
--
-- Also here: the `reserved_handles` seed for the new root segment `event`
-- (E1 added it to RESERVED_ROOT_SLUGS, the enforced list; this is the 166
-- defense-in-depth row).
--
-- ORDER-STRICT: run AFTER 180, BEFORE merging the E2 PR. App code merged
-- ahead DEGRADES: every read of the new columns is 42703-tolerant (the
-- live round falls back to the payload, the post count reads 0, the
-- ?contest= filter answers empty) and the stamp warns and continues.
-- ============================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS contest_id uuid REFERENCES contests(id) ON DELETE SET NULL;
ALTER TABLE group_posts
  ADD COLUMN IF NOT EXISTS contest_id uuid REFERENCES contests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_contest
  ON posts (contest_id) WHERE contest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_posts_contest
  ON group_posts (contest_id) WHERE contest_id IS NOT NULL;

COMMENT ON COLUMN posts.contest_id IS
  'The contest this post''s round was counted into (181). Written by the golf sync only; SET NULL on contest deletion.';
COMMENT ON COLUMN group_posts.contest_id IS
  'The contest this live round was counted into (181). Written by the golf sync only; SET NULL on contest deletion.';

-- ── Backfill from the results' roundRef (idempotent; only well-formed uuids) ─
UPDATE group_posts gp
   SET contest_id = r.contest_id
  FROM contest_results r
 WHERE gp.contest_id IS NULL
   AND (r.payload -> 'roundRef' ->> 'groupPostId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND (r.payload -> 'roundRef' ->> 'groupPostId')::uuid = gp.id;

UPDATE posts p
   SET contest_id = r.contest_id
  FROM contest_results r
 WHERE p.contest_id IS NULL
   AND p.round_id IS NOT NULL
   AND (r.payload -> 'roundRef' ->> 'roundId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND (r.payload -> 'roundRef' ->> 'roundId')::uuid = p.round_id;

-- ── The new root segment (E1) ───────────────────────────────────────────────
INSERT INTO reserved_handles (handle, reason)
VALUES ('event', 'Root path (vanity namespace, 181)')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'posts' AND column_name = 'contest_id')       AS posts_column_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'group_posts' AND column_name = 'contest_id') AS group_posts_column_ok,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_posts_contest')       AS posts_index_ok,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_group_posts_contest') AS group_posts_index_ok,
  EXISTS (SELECT 1 FROM reserved_handles WHERE handle = 'event')                AS event_reserved_ok;
