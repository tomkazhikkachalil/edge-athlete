-- ============================================================================
-- 313: golf_courses.sheet_sources — which source supplied what on a course's
--      scorecard (Nov 16 2026, the two-provider round PR 3;
--      docs/specs/golf-course-data.md, the Nov 16 note). Runs on BOTH staging
--      and prod. Order-safe: the writers read the column first and leave it
--      out when it is not there, so a card still saves without this file;
--      the credits simply start once it has run.
-- ============================================================================
-- A card is now filled from more than one provider (sheet-merge.ts): pars
-- from one, a tee's yardages, the stroke indexes or a tee's rating from
-- another. This column records the credit, written by the same UPDATE that
-- writes the card:
--   { "pars": "opengolfapi", "strokeIndex": "golfcourseapi",
--     "tees": { "white": "opengolfapi", "blue": "golfcourseapi" },
--     "ratings": { "blue": "golfcourseapi" } }
-- NULL = a card written before this migration (its source is not known; the
-- row's external_source is the best guess and is NOT backfilled as fact).
-- Why: a vendor's terms can require its data to be found and removed; without
-- the credit a merged card cannot be taken apart.
--
-- A column on an existing table: golf_courses' grants and policies (public
-- read, service_role write) already cover it. No index: never filtered on.
-- Reversal: ALTER TABLE public.golf_courses DROP COLUMN sheet_sources.
-- ============================================================================

ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS sheet_sources jsonb;

COMMENT ON COLUMN public.golf_courses.sheet_sources IS
  'Which source supplied what on the scorecard: {pars, strokeIndex, tees:{tee:source}, ratings:{tee:source}}. NULL = written before migration 313.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (313, '313_golf_course_sheet_sources.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 313 APPLIED | jsonb | true | 313
SELECT '313 APPLIED' AS result,
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_courses' AND column_name = 'sheet_sources') AS column_expect_jsonb,
       has_column_privilege('anon', 'public.golf_courses', 'sheet_sources', 'SELECT') AS anon_reads_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_313;
