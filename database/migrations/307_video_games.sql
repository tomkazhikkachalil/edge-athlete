-- ============================================================================
-- 307: game film — the game on a linked video, a tag's event on a highlight,
--      and the people in it (Nov 12 2026; Sprint 3, PR 2). Runs on BOTH
--      staging and prod BEFORE the code deploys.
-- ============================================================================
-- Tom's brief: clubs, leagues and sports creators post full games on YouTube
-- and tag them here — a highlight pinned to a moment, with an event type and
-- the athletes involved; EVERY STAT COMES FROM THE TAGS (Convention 60:
-- src/lib/videos/game-sheets.ts says what a tag adds, game-derive.ts computes
-- the score and the box score on every read — nothing is stored).
--
--   video_games — ONE row per video that is a game (optional).
--     sport_key      which sheet reads its tags.
--     played_on      the day of the game.
--     side1_* / side2_*  the two sides: a name, and optionally the team row
--                    (a team that leaves keeps its name here: SET NULL).
--     coverage       'highlights' (clips and counts; no score is claimed) or
--                    'full' (every scoring play is tagged: the score, the box
--                    score and the progressive reveal are shown).
--     stats_hidden   the spoiler-free default: viewers see the stats only as
--                    the video passes them, or after choosing to unlock.
--
--   video_highlights — four new columns; a row without event_key is the
--     plain marker it always was (golf's meta is untouched).
--     event_key      the sheet's event ('fg3_made', 'goal', 'takedown').
--     period         the quarter / half / set / inning / round / hole.
--     side           1 | 2 — whose event it is.
--     value          the number a tag carries (a penalty's minutes, a finish
--                    time in ms, strokes on a hole, a field mark).
--
--   video_highlight_people — who is in a tag, by role.
--     profile_id XOR name   a linked athlete, or a typed name for someone
--                    not here yet (linked later by a manager).
--     role           the sheet's role ('scorer', 'assist', 'goalie').
--     side           set only when the person is not where the role puts them.
--     status         active | removed — the tagged person (or a guardian)
--                    removes a tag of themselves; the row stays as the mark
--                    that it was refused, and the stat drops with it.
--     video_id       denormalised from the highlight (one read per game and
--                    per profile; kept true by the one writer).
--
-- Posture A on all three: RLS on, no policies, service role only — the one
-- writer is src/lib/videos/videos-server.ts. The new tables are created
-- EMPTY, so their indexes are inline; the two ADD COLUMNs are nullable with
-- no default (no rewrite). Every FK is a named ALTER with its own index
-- (fk-index-coverage). video_highlight_people.profile_id CASCADEs →
-- PROFILE_FK_POLICY 'survives' (a game's record outlives the person, as a
-- contest's stat line and media tag do).
--
-- REVERSAL: DROP TABLE public.video_highlight_people; DROP TABLE public.video_games;
--           ALTER TABLE public.video_highlights DROP COLUMN event_key, DROP COLUMN period, DROP COLUMN side, DROP COLUMN value;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 307) THEN
    RAISE EXCEPTION '307 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 306 THEN RAISE EXCEPTION '307 pre-flight: ledger head is %, expected 306', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'video_highlights') THEN
    RAISE EXCEPTION '307 pre-flight: public.video_highlights is missing — 296 has not run here';
  END IF;
END $$;

-- ── 1. video_games ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_games (
  video_id uuid NOT NULL,
  sport_key text NOT NULL CHECK (sport_key ~ '^[a-z0-9_]{2,40}$'),
  played_on date,
  side1_name text CHECK (side1_name IS NULL OR char_length(side1_name) BETWEEN 1 AND 80),
  side1_team_id uuid,
  side2_name text CHECK (side2_name IS NULL OR char_length(side2_name) BETWEEN 1 AND 80),
  side2_team_id uuid,
  coverage text NOT NULL DEFAULT 'highlights' CHECK (coverage IN ('highlights', 'full')),
  stats_hidden boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.video_games DROP CONSTRAINT IF EXISTS video_games_pkey;
ALTER TABLE public.video_games ADD CONSTRAINT video_games_pkey PRIMARY KEY (video_id);
ALTER TABLE public.video_games DROP CONSTRAINT IF EXISTS video_games_video_id_fkey;
ALTER TABLE public.video_games ADD CONSTRAINT video_games_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;
ALTER TABLE public.video_games DROP CONSTRAINT IF EXISTS video_games_side1_team_id_fkey;
ALTER TABLE public.video_games ADD CONSTRAINT video_games_side1_team_id_fkey FOREIGN KEY (side1_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.video_games DROP CONSTRAINT IF EXISTS video_games_side2_team_id_fkey;
ALTER TABLE public.video_games ADD CONSTRAINT video_games_side2_team_id_fkey FOREIGN KEY (side2_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.video_games DROP CONSTRAINT IF EXISTS video_games_created_by_user_id_fkey;
ALTER TABLE public.video_games ADD CONSTRAINT video_games_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS video_games_side1_team_id_idx ON public.video_games (side1_team_id);
CREATE INDEX IF NOT EXISTS video_games_side2_team_id_idx ON public.video_games (side2_team_id);
CREATE INDEX IF NOT EXISTS video_games_created_by_user_id_idx ON public.video_games (created_by_user_id);
DROP TRIGGER IF EXISTS video_games_updated_at ON public.video_games;
CREATE TRIGGER video_games_updated_at BEFORE UPDATE ON public.video_games FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.video_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_games FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_games TO service_role;
COMMENT ON TABLE public.video_games IS 'The game on a linked video (307): the sport whose sheet reads its tags, the day, the two sides (a name, optionally a team), coverage (highlights | full) and the spoiler-free default. Its stats are DERIVED from the tags on every read (Convention 60) — none are stored. Posture A.';

-- ── 2. A tag''s event on a highlight ─────────────────────────────────────────
ALTER TABLE public.video_highlights ADD COLUMN IF NOT EXISTS event_key text;
ALTER TABLE public.video_highlights ADD COLUMN IF NOT EXISTS period smallint;
ALTER TABLE public.video_highlights ADD COLUMN IF NOT EXISTS side smallint;
ALTER TABLE public.video_highlights ADD COLUMN IF NOT EXISTS value integer;
ALTER TABLE public.video_highlights DROP CONSTRAINT IF EXISTS video_highlights_event_key_check;
ALTER TABLE public.video_highlights ADD CONSTRAINT video_highlights_event_key_check CHECK (event_key IS NULL OR event_key ~ '^[a-z0-9_]{2,32}$');
ALTER TABLE public.video_highlights DROP CONSTRAINT IF EXISTS video_highlights_period_check;
ALTER TABLE public.video_highlights ADD CONSTRAINT video_highlights_period_check CHECK (period IS NULL OR period BETWEEN 1 AND 99);
ALTER TABLE public.video_highlights DROP CONSTRAINT IF EXISTS video_highlights_side_check;
ALTER TABLE public.video_highlights ADD CONSTRAINT video_highlights_side_check CHECK (side IS NULL OR side IN (1, 2));
ALTER TABLE public.video_highlights DROP CONSTRAINT IF EXISTS video_highlights_value_check;
ALTER TABLE public.video_highlights ADD CONSTRAINT video_highlights_value_check CHECK (value IS NULL OR value BETWEEN 0 AND 86400000);
COMMENT ON COLUMN public.video_highlights.event_key IS 'The game sheet''s event this tag is (307; src/lib/videos/game-sheets.ts). NULL = a plain marker: a clip, never a stat.';

-- ── 3. video_highlight_people ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_highlight_people (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  highlight_id uuid NOT NULL,
  video_id uuid NOT NULL,
  profile_id uuid,
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role ~ '^[a-z0-9_]{2,32}$'),
  side smallint CHECK (side IS NULL OR side IN (1, 2)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_by_user_id uuid,
  removed_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT video_highlight_people_one_person_check CHECK (num_nonnulls(profile_id, name) = 1)
);
ALTER TABLE public.video_highlight_people DROP CONSTRAINT IF EXISTS video_highlight_people_pkey;
ALTER TABLE public.video_highlight_people ADD CONSTRAINT video_highlight_people_pkey PRIMARY KEY (id);
ALTER TABLE public.video_highlight_people DROP CONSTRAINT IF EXISTS video_highlight_people_highlight_id_fkey;
ALTER TABLE public.video_highlight_people ADD CONSTRAINT video_highlight_people_highlight_id_fkey FOREIGN KEY (highlight_id) REFERENCES public.video_highlights(id) ON DELETE CASCADE;
ALTER TABLE public.video_highlight_people DROP CONSTRAINT IF EXISTS video_highlight_people_video_id_fkey;
ALTER TABLE public.video_highlight_people ADD CONSTRAINT video_highlight_people_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;
ALTER TABLE public.video_highlight_people DROP CONSTRAINT IF EXISTS video_highlight_people_profile_id_fkey;
ALTER TABLE public.video_highlight_people ADD CONSTRAINT video_highlight_people_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.video_highlight_people DROP CONSTRAINT IF EXISTS video_highlight_people_removed_by_user_id_fkey;
ALTER TABLE public.video_highlight_people ADD CONSTRAINT video_highlight_people_removed_by_user_id_fkey FOREIGN KEY (removed_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.video_highlight_people DROP CONSTRAINT IF EXISTS video_highlight_people_created_by_user_id_fkey;
ALTER TABLE public.video_highlight_people ADD CONSTRAINT video_highlight_people_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- One person once per role on a tag (a typed name the same, whatever its case).
CREATE UNIQUE INDEX IF NOT EXISTS video_highlight_people_profile_role_uidx ON public.video_highlight_people (highlight_id, profile_id, role) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS video_highlight_people_name_role_uidx ON public.video_highlight_people (highlight_id, lower(name), role) WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_highlight_people_highlight_id_idx ON public.video_highlight_people (highlight_id);
CREATE INDEX IF NOT EXISTS video_highlight_people_video_id_idx ON public.video_highlight_people (video_id);
CREATE INDEX IF NOT EXISTS video_highlight_people_profile_id_idx ON public.video_highlight_people (profile_id);
CREATE INDEX IF NOT EXISTS video_highlight_people_removed_by_user_id_idx ON public.video_highlight_people (removed_by_user_id);
CREATE INDEX IF NOT EXISTS video_highlight_people_created_by_user_id_idx ON public.video_highlight_people (created_by_user_id);
ALTER TABLE public.video_highlight_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_highlight_people FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_highlight_people TO service_role;
COMMENT ON TABLE public.video_highlight_people IS 'Who is in a tag on a linked video (307): a profile XOR a typed name, the sheet''s role, active | removed (the tagged person or a guardian removes a tag of themselves — the stat drops with it). video_id is denormalised from the highlight. Posture A.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (307, '307_video_games.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 307 APPLIED | 2 | 4 | false | 307
SELECT '307 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('video_games', 'video_highlight_people')) AS tables_expect_2,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'video_highlights' AND column_name IN ('event_key', 'period', 'side', 'value')) AS columns_expect_4,
       has_table_privilege('anon', 'public.video_games', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_307;
