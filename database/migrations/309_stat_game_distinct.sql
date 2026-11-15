-- ============================================================================
-- 309: stats — "these are two different games" (Nov 14 2026; film in the
--      season totals, PR C4). Runs on BOTH staging and prod BEFORE the code
--      deploys.
-- ============================================================================
-- One game is counted once (src/lib/performance/same-game.ts): an official
-- line, a club's or league's verified film and the athlete's own post of the
-- same game count as ONE, by rank. Without a contest to tie them, "the same
-- game" is the same DATE in a sport with two sides — which is wrong for a
-- doubleheader. The athlete (or their guardian) says so here, and both count.
--
--   stat_game_distinct — one row per pair the athlete has said are two games.
--     profile_id          whose stats.
--     sport_key           the sport the pair is in.
--     game_a / game_b     the two games as the rule names them
--                         (`official:<contest>`, `film:<video>`,
--                         `post:<post>`), game_a < game_b so a pair has ONE
--                         spelling. They are names, not foreign keys: a game
--                         that is deleted simply stops matching.
--     created_by_user_id  who said it (a guardian, for a child).
--
-- It never overrides an exact contest link — the rule does not ask it then.
--
-- Posture A: RLS on, no policies, service role only — the one writer is
-- src/lib/performance/game-distinct-server.ts. Created EMPTY, so the indexes
-- are inline. Every FK is a named ALTER with its own index
-- (fk-index-coverage). profile_id CASCADEs → PROFILE_FK_POLICY 'goes' (what
-- the athlete said about their own games leaves with them).
--
-- REVERSAL: DROP TABLE public.stat_game_distinct;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 309) THEN
    RAISE EXCEPTION '309 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 308 THEN RAISE EXCEPTION '309 pre-flight: ledger head is %, expected 308', n; END IF;
END $$;

-- ── 1. stat_game_distinct ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stat_game_distinct (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  sport_key text NOT NULL CHECK (char_length(sport_key) BETWEEN 1 AND 40),
  game_a text NOT NULL,
  game_b text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT stat_game_distinct_keys_check CHECK (
    game_a ~ '^(official|film|post):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND game_b ~ '^(official|film|post):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT stat_game_distinct_order_check CHECK (game_a < game_b)
);
ALTER TABLE public.stat_game_distinct DROP CONSTRAINT IF EXISTS stat_game_distinct_pkey;
ALTER TABLE public.stat_game_distinct ADD CONSTRAINT stat_game_distinct_pkey PRIMARY KEY (id);
ALTER TABLE public.stat_game_distinct DROP CONSTRAINT IF EXISTS stat_game_distinct_profile_id_fkey;
ALTER TABLE public.stat_game_distinct ADD CONSTRAINT stat_game_distinct_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.stat_game_distinct DROP CONSTRAINT IF EXISTS stat_game_distinct_created_by_user_id_fkey;
ALTER TABLE public.stat_game_distinct ADD CONSTRAINT stat_game_distinct_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- A pair is said once.
CREATE UNIQUE INDEX IF NOT EXISTS stat_game_distinct_pair_uidx ON public.stat_game_distinct (profile_id, game_a, game_b);
CREATE INDEX IF NOT EXISTS stat_game_distinct_profile_sport_idx ON public.stat_game_distinct (profile_id, sport_key);
CREATE INDEX IF NOT EXISTS stat_game_distinct_created_by_user_id_idx ON public.stat_game_distinct (created_by_user_id);
ALTER TABLE public.stat_game_distinct ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stat_game_distinct FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.stat_game_distinct TO service_role;
COMMENT ON TABLE public.stat_game_distinct IS 'Pairs of games an athlete has said are two different games (309), so the same-game rule counts both (src/lib/performance/same-game.ts; docs/specs/video-games.md). Service role only; the one writer is src/lib/performance/game-distinct-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (309, '309_stat_game_distinct.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 309 APPLIED | 1 | 3 | false | 309
SELECT '309 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stat_game_distinct') AS tables_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'stat_game_distinct' AND indexname <> 'stat_game_distinct_pkey') AS indexes_expect_3,
       has_table_privilege('anon', 'public.stat_game_distinct', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_309;
