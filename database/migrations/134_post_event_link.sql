-- ============================================================================
-- 134: post ↔ calendar-event link (Family Console Wave 5 — media day)
-- ============================================================================
-- The guardian batch upload offers "this looks like Saturday's tournament —
-- attach?" from media capture times. A confirmed offer records the link here.
--
--   * Suggestion-confirmed ONLY: nothing writes this column without the
--     guardian tapping Attach (the matcher refuses ambiguous cases outright —
--     src/lib/calendar/event-autotag.ts carries the reliability caveats).
--   * The posts POST validates the TARGET ATHLETE is on the event (organizer
--     or event_guests row) before accepting an eventId.
--   * SET NULL on event deletion — a deleted event must not take posts with
--     it (the orphaned-league precedent: posts are the athlete's record).
--   * Mirrors the round_id/group_post_id linkage shape.
-- ============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_event_id
  ON posts (event_id)
  WHERE event_id IS NOT NULL;

COMMENT ON COLUMN posts.event_id IS
  'Calendar event this post was captured at (guardian batch upload, 134). Suggestion-confirmed only; SET NULL on event deletion.';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'posts' AND column_name = 'event_id')  AS column_ok,
  EXISTS (SELECT 1 FROM pg_indexes
            WHERE indexname = 'idx_posts_event_id')                   AS index_ok;
