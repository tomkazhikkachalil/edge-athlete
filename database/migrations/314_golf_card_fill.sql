-- ============================================================================
-- 314: the scorecard fill — golf_courses.opengolf_id / sheet_fill_at /
--      sheet_fill_outcome, the queue's index and golf_card_fill_link()
--      (Nov 17 2026; docs/specs/golf-course-data.md, the Nov 17 note). Runs on
--      BOTH staging and prod. Order-safe: the fill answers "migration 314 has
--      not run" and writes nothing until this file has run.
-- ============================================================================
-- Production held 28,987 courses and 78 scorecards. Tom (Nov 17): fill the
-- cards in the background from OpenGolfAPI, whose data is ODbL (copying it is
-- what the licence is for); GolfCourseAPI stays on a pick only (its terms).
--
--   opengolf_id        the OpenGolfAPI course this row IS, linked from its
--                      published file by name and distance (card-fill.ts
--                      linkDataset: one candidate within 2 km, never a guess).
--   sheet_fill_at      when the fill last ASKED for this row's card (a refusal
--                      is stamped too; a transport failure never is).
--   sheet_fill_outcome what came back: 'ok' or the reason the card was refused
--                      (card-fill.ts cardFillVerdict).
--
-- A column on an existing table: golf_courses' grants and policies (public
-- read, service_role write) already cover them. The index is the fill's queue.
-- golf_card_fill_link writes many links in one trip (a link per request would
-- be thousands of trips); SECURITY INVOKER and service_role only.
-- Reversal: DROP FUNCTION public.golf_card_fill_link(jsonb); DROP INDEX
-- public.idx_golf_courses_card_fill; ALTER TABLE public.golf_courses DROP
-- COLUMN opengolf_id, DROP COLUMN sheet_fill_at, DROP COLUMN sheet_fill_outcome.
-- ============================================================================

ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS opengolf_id text,
  ADD COLUMN IF NOT EXISTS sheet_fill_at timestamptz,
  ADD COLUMN IF NOT EXISTS sheet_fill_outcome text;

COMMENT ON COLUMN public.golf_courses.opengolf_id IS
  'The OpenGolfAPI course id this row was linked to from its published ODbL file (migration 314). NULL = not linked.';
COMMENT ON COLUMN public.golf_courses.sheet_fill_at IS
  'When the scorecard fill last asked for this row''s card (migration 314). NULL = never asked.';
COMMENT ON COLUMN public.golf_courses.sheet_fill_outcome IS
  'What the scorecard fill''s last ask came to: ok, or why the card was refused (migration 314).';

CREATE INDEX IF NOT EXISTS idx_golf_courses_card_fill
  ON public.golf_courses (sheet_fill_at NULLS FIRST)
  WHERE opengolf_id IS NOT NULL AND hole_data IS NULL;

CREATE OR REPLACE FUNCTION public.golf_card_fill_link(p_pairs jsonb)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH done AS (
    UPDATE public.golf_courses g
       SET opengolf_id = x.og
      FROM jsonb_to_recordset(p_pairs) AS x(id uuid, og text)
     WHERE g.id = x.id
       AND g.opengolf_id IS NULL
       AND x.og IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$$;

REVOKE EXECUTE ON FUNCTION public.golf_card_fill_link(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_card_fill_link(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (314, '314_golf_card_fill.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 314 APPLIED | 3 | 1 | false | 314
SELECT '314 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_courses' AND column_name IN ('opengolf_id', 'sheet_fill_at', 'sheet_fill_outcome')) AS columns_expect_3,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_courses_card_fill') AS index_expect_1,
       has_function_privilege('anon', 'public.golf_card_fill_link(jsonb)', 'EXECUTE') AS anon_executes_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_314;
