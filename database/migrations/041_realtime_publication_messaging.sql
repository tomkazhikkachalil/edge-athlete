-- ============================================================================
-- Migration 041 — Realtime publication for messaging (+ re-asserts)
-- ============================================================================
-- Messages felt slow because they WERE slow: ChatWindow and the messages
-- provider subscribe to postgres_changes on `messages` (INSERT + UPDATE for
-- read receipts), but no migration ever added `messages` to the
-- supabase_realtime publication — the 30s poll fallback was the only
-- delivery mechanism the feature ever had. Same failure class as the golf
-- tables (038).
--
-- Also RE-ASSERTS `posts` and `notifications`: their publication membership
-- came from ARCHIVED scripts (enable-realtime-*.sql) with no verified-live
-- record — the same unverified category migration 031 turned out to be.
-- Idempotent: present tables are skipped.
--
-- REPLICA IDENTITY not needed (INSERT/UPDATE payloads carry the full row
-- with default identity; deletes don't matter for these features).
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- No deploy needed — the client subscriptions are already live and waiting.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages', 'posts', 'notifications'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── Verification (run after; SQL editor only) ───────────────────────────────
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime' ORDER BY tablename;
--   → expect: golf_participant_scores, group_posts, messages, notifications,
--             posts (plus anything added previously)
-- Functional: after running, I verify empirically with a two-client script,
-- then messages should appear INSTANTLY across devices (no 30s wait).
