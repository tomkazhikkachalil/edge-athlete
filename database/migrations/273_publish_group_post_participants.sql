-- ============================================================================
-- 273: group_post_participants joins the realtime publication (Oct 25 2026 —
--      scale fix 1, docs/SCALE_AUDIT.md hole 1). Runs on BOTH staging and prod.
--      Code rides with it (useSharedRound filters its scores subscription to
--      the round and listens for the round's joiners); order-independent — the
--      hook's 60 s poll carries a joiner until this is live.
-- ============================================================================
-- useSharedRound subscribed to golf_participant_scores TABLE-WIDE (every score
-- written anywhere reached every spectator and live feed card, each delivery
-- a refetch — Realtime delivers one change event once PER SUBSCRIBER, so one
-- busy round could take the project past its 500 msgs/s). The repo twice
-- declined a `participant_id=in.(roster)` filter (Sep 22, Oct 4) because a
-- late joiner's first card is an INSERT with an id the roster does not know.
-- Publishing group_post_participants lets the hook hear the joiner
-- (`group_post_id=eq.{round}` — the table HAS the column the scores table
-- lacks), refresh the roster and resubscribe with the new filter.
--
-- Pre-flight:
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' ORDER BY 1;
--   -- golf_participant_scores, group_posts, messages, notifications (4) → 5 after
--
-- Reversal: ALTER PUBLICATION supabase_realtime DROP TABLE public.group_post_participants;
-- Re-runnable (the add is guarded; the ledger row is ON CONFLICT).
-- ============================================================================

DO $$
BEGIN
  IF (SELECT max(number) FROM public.schema_migrations) < 272 THEN
    RAISE EXCEPTION '273 needs the ledger at 272 first (head is %)', (SELECT max(number) FROM public.schema_migrations);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_post_participants') THEN
    RAISE NOTICE '273: group_post_participants already in supabase_realtime — nothing to do';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_post_participants;
    RAISE NOTICE '273: group_post_participants added to supabase_realtime';
  END IF;
END $$;

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (273, '273_publish_group_post_participants.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 273 APPLIED | 5 | true | 273
SELECT '273 APPLIED' AS result,
       (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public') AS published_tables_expect_5,
       EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_post_participants') AS participants_published_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_273;
