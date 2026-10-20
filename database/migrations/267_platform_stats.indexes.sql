-- ============================================================================
-- 267_platform_stats.indexes.sql — the CONCURRENTLY twin of 267 (Oct 19 2026)
-- ============================================================================
-- The nightly rollup counts each day's rows over a created_at range on four
-- tables that had no such index. CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction. The Supabase DASHBOARD editor wraps even a single statement
-- in one (proven Oct 19 2026: one pasted statement → 25001), so from the
-- editor this file cannot run as written. Two honest ways:
--   • the Management API runs one statement without a transaction —
--     `node scripts/staging-sql.mjs -e "<one statement>"` four times (how
--     staging got them);
--   • while a table is SMALL (production on Oct 19 2026: a handful of rows
--     each), the plain `CREATE INDEX IF NOT EXISTS …` form locks it for
--     milliseconds — paste the four statements WITHOUT `CONCURRENTLY` in one
--     editor run (how production got them). Only a table with real volume
--     needs CONCURRENTLY, and then the API path (or psql) is the way.
-- Idempotent. The grid in database/tests/diagnostics/verify-267-platform-stats.sql
-- checks the four by name and validity, not by how they were built.
-- Not needed: profiles (users.new reads profile_seen.first_day), posts
-- (idx_posts_created_at, 190), notifications (003), contacts (266).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_created_at ON public.activities (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workout_sessions_created_at ON public.workout_sessions (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_created_at ON public.tickets (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_at ON public.organizations (created_at);
