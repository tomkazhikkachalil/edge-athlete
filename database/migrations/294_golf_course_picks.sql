-- ============================================================================
-- 294: which picked courses have a card (Oct 31 2026; Tom: spend later on the
--      courses people actually play). Runs on BOTH staging and prod BEFORE
--      the code deploys.
-- ============================================================================
-- One row per course: its card kind at the latest pick and a counter. No user
-- ids. Service role only: RLS on with no policies. The ONE writer is the
-- golf_course_pick_hit RPC, called best-effort from GET /api/golf/courses.
--
-- REVERSAL: DROP FUNCTION public.golf_course_pick_hit(uuid, text);
--           DROP TABLE public.golf_course_picks;
-- A second run stops in the pre-flight.
-- ============================================================================

DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 294) THEN
    RAISE EXCEPTION '294 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 293 THEN RAISE EXCEPTION '294 pre-flight: ledger head is %, expected 293', n; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.golf_course_picks (
  course_id uuid PRIMARY KEY REFERENCES public.golf_courses(id) ON DELETE CASCADE,
  card text NOT NULL CHECK (card IN ('provider', 'map', 'none')),
  picks integer NOT NULL DEFAULT 1,
  first_picked_at timestamptz NOT NULL DEFAULT now(),
  last_picked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS golf_course_picks_card_picks_idx ON public.golf_course_picks (card, picks DESC);
ALTER TABLE public.golf_course_picks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.golf_course_picks TO service_role;
COMMENT ON TABLE public.golf_course_picks IS 'Picks per course and the card each had at the latest pick (294). No user ids. Service role only.';

CREATE OR REPLACE FUNCTION public.golf_course_pick_hit(p_course_id uuid, p_card text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.golf_course_picks (course_id, card) VALUES (p_course_id, p_card)
  ON CONFLICT (course_id) DO UPDATE
    SET card = EXCLUDED.card, picks = public.golf_course_picks.picks + 1, last_picked_at = now();
$$;
REVOKE ALL ON FUNCTION public.golf_course_pick_hit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_course_pick_hit(uuid, text) TO service_role;

INSERT INTO public.schema_migrations (number, name) VALUES (294, '294_golf_course_picks.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 294 APPLIED | 1 | 294
SELECT '294 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'golf_course_picks') AS table_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_294;
