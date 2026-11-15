-- ============================================================================
-- 311: the athlete hides a game or a clip from their own page (Nov 16 2026;
--      Sprint 4 PR 6a). Runs on BOTH staging and prod BEFORE the code deploys
--      (the readers answer "nothing hidden" without the table; the writer
--      answers 503).
-- ============================================================================
-- Tom, Nov 15 2026: an athlete can hide a game or a single clip from their
-- page; THE STAT STILL COUNTS. "Remove me" (the tag is removed, the stat
-- drops for everyone) stays as the stronger door. Hiding is about the
-- athlete's own page only: the club's video, its box score and its other
-- players are untouched.
--
--   profile_film_hidden — one row per thing hidden.
--     profile_id          whose page.
--     video_id            the game's video.
--     highlight_id        the clip, or NULL: the whole game.
--     created_by_user_id  who hid it (a guardian, for a child).
--
-- A hidden game leaves the athlete's game log, reels and Clips browser for
-- every viewer but the athlete and their guardian; a hidden clip leaves the
-- reels and the browser. Totals are unchanged (docs/specs/sport-profile.md).
--
-- Posture A: RLS on, no policies, service role only — the one writer is
-- src/lib/sport-profile/film-hide-server.ts. Created EMPTY, so the indexes
-- are inline. Every FK is a named ALTER with its own index
-- (fk-index-coverage). profile_id CASCADEs → PROFILE_FK_POLICY 'goes' (what
-- the athlete hid on their own page leaves with them). The video and the
-- clip CASCADE too: a hidden thing that is gone needs no row.
--
-- REVERSAL: DROP TABLE public.profile_film_hidden;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 311) THEN
    RAISE EXCEPTION '311 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 310 THEN RAISE EXCEPTION '311 pre-flight: ledger head is %, expected 310', n; END IF;
  IF to_regclass('public.video_highlights') IS NULL OR to_regclass('public.videos') IS NULL THEN
    RAISE EXCEPTION '311 pre-flight: videos / video_highlights are missing — 296 has not run here';
  END IF;
END $$;

-- ── 1. profile_film_hidden ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_film_hidden (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  video_id uuid NOT NULL,
  highlight_id uuid,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.profile_film_hidden DROP CONSTRAINT IF EXISTS profile_film_hidden_pkey;
ALTER TABLE public.profile_film_hidden ADD CONSTRAINT profile_film_hidden_pkey PRIMARY KEY (id);
ALTER TABLE public.profile_film_hidden DROP CONSTRAINT IF EXISTS profile_film_hidden_profile_id_fkey;
ALTER TABLE public.profile_film_hidden ADD CONSTRAINT profile_film_hidden_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profile_film_hidden DROP CONSTRAINT IF EXISTS profile_film_hidden_video_id_fkey;
ALTER TABLE public.profile_film_hidden ADD CONSTRAINT profile_film_hidden_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;
ALTER TABLE public.profile_film_hidden DROP CONSTRAINT IF EXISTS profile_film_hidden_highlight_id_fkey;
ALTER TABLE public.profile_film_hidden ADD CONSTRAINT profile_film_hidden_highlight_id_fkey FOREIGN KEY (highlight_id) REFERENCES public.video_highlights(id) ON DELETE CASCADE;
ALTER TABLE public.profile_film_hidden DROP CONSTRAINT IF EXISTS profile_film_hidden_created_by_user_id_fkey;
ALTER TABLE public.profile_film_hidden ADD CONSTRAINT profile_film_hidden_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- A game is hidden once; a clip is hidden once.
CREATE UNIQUE INDEX IF NOT EXISTS profile_film_hidden_game_uidx ON public.profile_film_hidden (profile_id, video_id) WHERE highlight_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profile_film_hidden_clip_uidx ON public.profile_film_hidden (profile_id, highlight_id) WHERE highlight_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profile_film_hidden_video_id_idx ON public.profile_film_hidden (video_id);
CREATE INDEX IF NOT EXISTS profile_film_hidden_highlight_id_idx ON public.profile_film_hidden (highlight_id);
CREATE INDEX IF NOT EXISTS profile_film_hidden_created_by_user_id_idx ON public.profile_film_hidden (created_by_user_id);
ALTER TABLE public.profile_film_hidden ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_film_hidden FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profile_film_hidden TO service_role;
COMMENT ON TABLE public.profile_film_hidden IS 'A game (highlight_id NULL) or a clip an athlete hid from their own page (311): it leaves their game log, reels and Clips browser for visitors; the stat still counts (docs/specs/sport-profile.md). Service role only; the one writer is src/lib/sport-profile/film-hide-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (311, '311_profile_film_hidden.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 311 APPLIED | 1 | 5 | false | 311
SELECT '311 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profile_film_hidden') AS tables_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'profile_film_hidden' AND indexname <> 'profile_film_hidden_pkey') AS indexes_expect_5,
       has_table_privilege('anon', 'public.profile_film_hidden', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_311;
