-- ============================================================================
-- 267_platform_stats.indexes.sql — the CONCURRENTLY twin of 267 (Oct 19 2026)
-- ============================================================================
-- The nightly rollup counts each day's rows over a created_at range on four
-- tables that had no such index. CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction, and the SQL editor runs a file as ONE transaction — so this
-- file is NOT run as a file: paste and run EACH statement on its own
-- (staging: `node scripts/staging-sql.mjs -e "<one statement>"` four times;
-- prod: one statement per SQL-editor run). Idempotent. The grid in
-- database/tests/diagnostics/verify-267-platform-stats.sql checks all four.
-- Not needed: profiles (users.new reads profile_seen.first_day), posts
-- (idx_posts_created_at, 190), notifications (003), contacts (266).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_created_at ON public.activities (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workout_sessions_created_at ON public.workout_sessions (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_created_at ON public.tickets (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_at ON public.organizations (created_at);
