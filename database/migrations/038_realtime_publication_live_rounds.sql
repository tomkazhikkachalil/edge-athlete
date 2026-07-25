-- ============================================================================
-- Migration 038 — Realtime publication for live rounds
-- ============================================================================
-- Two additions to the supabase_realtime publication:
--   • golf_participant_scores — RE-ASSERTS migration 031, which has no
--     "verified live" record; if it was never run, live score streaming has
--     been a silent no-op the whole time. Idempotent either way.
--   • group_posts — NEW: status flips (pending→active→completed, End Round,
--     the lazy 6h auto-end persistence) stream to every viewer, so LIVE→FINAL
--     updates without a reload.
--
-- REPLICA IDENTITY deliberately NOT set: only INSERT/UPDATE events matter
-- for live rounds; deletes being undeliverable is acceptable.
-- RLS note: realtime delivers group_posts rows through the existing SELECT
-- policies (public rounds / participants) — no policy changes needed.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- Idempotent — safe to run repeatedly.
-- ============================================================================

-- Curiosity check (run first if you want the historical answer): whether 031
-- was ever applied —
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['golf_participant_scores', 'group_posts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── Verification (run after; SQL editor only — PostgREST can't see pg_catalog)
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime'
--    AND tablename IN ('golf_participant_scores', 'group_posts');
--   → expect BOTH rows.
