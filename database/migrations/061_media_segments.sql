-- ============================================================================
-- Migration 061 — Sport-agnostic media segments
-- ============================================================================
-- Media attaches to a SEGMENT of an event, not to a golf hole: hole (golf),
-- inning (baseball), quarter/period (basketball, hockey), set (tennis,
-- volleyball), lap (track). group_posts / group_post_participants /
-- group_post_media are already documented in 004 as generic ("any sport or
-- activity type") — `hole_number` (042) was the single golf-specific thing in
-- the table, so generalising it is what makes the media-per-moment feature
-- work for sport #2 without a rewrite.
--
-- EXPAND half of an expand/contract. `hole_number` is kept and still written
-- (see the dual-write note below) so this migration is safe to run AHEAD of the
-- code deploy and safe to roll back to. Migration 06x-contract drops it later,
-- once no client sends it.
--
-- ⚠️ RUN BEFORE DEPLOYING. The scorecard SELECT embeds segment_number /
--    segment_kind / duration_seconds → 42703 (undefined column) otherwise, and
--    that select backs the whole round detail view. Idempotent.
--    Supabase SQL Editor; expect green "Success".
--
-- ── Pre-flight ──────────────────────────────────────────────────────────────
-- SELECT count(*) AS rows_to_backfill FROM group_post_media
--  WHERE hole_number IS NOT NULL;
-- ============================================================================

ALTER TABLE group_post_media
  ADD COLUMN IF NOT EXISTS segment_number INTEGER,
  ADD COLUMN IF NOT EXISTS segment_kind TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

-- NO CHECK CONSTRAINT ON segment_number, deliberately.
-- `hole_number` carried `BETWEEN 1 AND 18`, which meant every new sport needed
-- a migration — extra innings and overtime periods would violate a fixed
-- ceiling. Bounds now live in src/lib/sports/segment-schemas.ts and are
-- enforced by the API, where they can be per-sport and lenient where the sport
-- is. A non-negative floor is the only thing that is universally true.
ALTER TABLE group_post_media
  DROP CONSTRAINT IF EXISTS group_post_media_segment_number_positive;
ALTER TABLE group_post_media
  ADD CONSTRAINT group_post_media_segment_number_positive
  CHECK (segment_number IS NULL OR segment_number > 0);

COMMENT ON COLUMN group_post_media.segment_number IS
  'Which slice of the event this media belongs to (hole/inning/quarter/set/lap). NULL = event-level media. Bounds enforced per-sport in segment-schemas.ts, not here.';
COMMENT ON COLUMN group_post_media.segment_kind IS
  'What that slice is called: hole | inning | quarter | set | lap. Stored rather than derived because this table carries no sport key, so deriving would mean a join on every read.';
COMMENT ON COLUMN group_post_media.duration_seconds IS
  'Video length in seconds, captured client-side at upload. NULL for images and for rows predating this column.';
COMMENT ON COLUMN group_post_media.hole_number IS
  'DEPRECATED — superseded by segment_number/segment_kind (migration 061). Still written for golf while both columns coexist; dropped by the contract migration.';

-- Backfill. Every existing row is golf, since hole_number was the only tagging
-- that ever existed.
UPDATE group_post_media
   SET segment_number = hole_number,
       segment_kind   = 'hole'
 WHERE hole_number IS NOT NULL
   AND segment_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_group_media_segment
  ON group_post_media(group_post_id, segment_number);

-- idx_group_media_hole (042) is intentionally LEFT IN PLACE. Both indexes
-- coexist during dual-write; the contract migration drops the old one.

-- ── Dual-write note (for the application layer) ─────────────────────────────
-- hole_number still has its BETWEEN 1 AND 18 constraint, so the API writes it
-- ONLY when segment_kind = 'hole' AND 1 <= segment_number <= 18, and NULL
-- otherwise. Golf is the only sport in production today, so nothing regresses
-- now, and a future lap-24 row will not violate the old constraint.

-- ── Verification (run after) ────────────────────────────────────────────────
-- 1. Columns exist:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'group_post_media'
--    AND column_name IN ('segment_number','segment_kind','duration_seconds');
--    → 3 rows
--
-- 2. Backfill is complete — this MUST return 0:
-- SELECT count(*) FROM group_post_media
--  WHERE hole_number IS NOT NULL AND segment_number IS NULL;
--
-- 3. Backfill is faithful — this MUST return 0:
-- SELECT count(*) FROM group_post_media
--  WHERE hole_number IS NOT NULL
--    AND (segment_number IS DISTINCT FROM hole_number OR segment_kind <> 'hole');
--
-- 4. Index exists:
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'group_post_media' AND indexname = 'idx_group_media_segment';
