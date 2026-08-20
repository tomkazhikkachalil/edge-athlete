-- ============================================================================
-- Migration 092 — Functional index for stat-line dates on the calendar
-- ============================================================================
-- Stat-line posts (hockey/basketball/… game logs, stats_data.type =
-- 'stat_line') now appear on the calendar on the DATE THE ATHLETE ENTERED
-- (stats_data->>'date', 'YYYY-MM-DD'), not created_at — you can log
-- Saturday's game on Monday. The overlay query is a per-user date-range scan
-- over that JSONB text field on every calendar load (month grid + feed
-- widget — one of the hottest reads), and no existing posts index covers it:
-- idx_posts_stats_media (020) is ordered by created_at, exactly the wrong
-- column. This was the reason the feature sat deferred since Aug 11.
--
-- Partial functional btree; no CONCURRENTLY (the SQL editor runs one
-- transaction — 087's precedent). Feature degrades gracefully unindexed, so
-- deploy order vs the app change is flexible.

CREATE INDEX IF NOT EXISTS idx_posts_stat_line_date
  ON posts (profile_id, (stats_data->>'date'))
  WHERE stats_data->>'type' = 'stat_line';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check (run separately if pasting mangles quotes) ─────────────
-- Expect one row naming the index.
SELECT indexname FROM pg_indexes
WHERE tablename = 'posts' AND indexname = 'idx_posts_stat_line_date';
