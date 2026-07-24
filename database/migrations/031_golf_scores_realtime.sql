-- ============================================================================
-- Migration 031 — Enable Realtime for golf_participant_scores (live scoring)
-- ============================================================================
-- The useSharedRound hook subscribes to golf_participant_scores changes so a
-- shared round's leaderboard updates LIVE for everyone playing as scores are
-- entered. Realtime only delivers changes for tables in the supabase_realtime
-- publication (same enablement the messaging system needed).
--
-- Realtime respects RLS: the golf_participant_scores SELECT policy (migration
-- 004) already scopes score visibility to the round's participants/creator, so
-- live events reach exactly the right people. No new policy needed.
--
-- Safe/idempotent: adding a table already in the publication is a no-op guarded
-- below. Nothing breaks if this isn't run — the hook's subscription simply
-- never fires and the app falls back to refresh-on-save.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'golf_participant_scores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.golf_participant_scores;
  END IF;
END $$;

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND tablename = 'golf_participant_scores';
--   → one row
