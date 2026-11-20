-- ============================================================================
-- 317: golf — a scorecard's pars are kept as EVIDENCE, and every change to a
--      par is logged (Nov 20 2026). Runs on BOTH staging and prod BEFORE the
--      code deploys.
-- ============================================================================
-- Three scorecards needed hand-run SQL in one day. GolfCourseAPI answers pars
-- per tee box, the boxes contradict each other, and no rule picks the right
-- box every time; the per-tee pars were thrown away when the card was saved,
-- so re-judging a card meant asking the provider again. Tom (Nov 20): this
-- cannot go card by card. The app may correct a DISPUTED hole's par on a
-- filled card when an independent source settles it (only such holes, only to
-- a par one of the provider's tees gave, logged); manual corrections happen on
-- the admin console only.
--
--   golf_par_evidence — what each source said, one row per source and label.
--     course_id   the catalog course.
--     source      golfcourseapi | opengolfapi | website | admin.
--     label       the tee box ('black', 'white (f)'), or '' for a source that
--                 answers one par row.
--     votes       a men's box votes on the card; a women's box is kept (its
--                 pars are often different and right for those tees) and does
--                 not.
--     pars        one entry per hole, in hole order; NULL where the source
--                 did not say.
--     observed_at when it was last read.
--   A vendor's rows are found, and removed, by `source`.
--
--   golf_par_changes — the record of every par the app or an admin changed
--     on a saved card: the hole, from and to, why (settled | admin), which
--     source settled it, who (an admin's email, or 'system'), and what every
--     source said at that moment.
--
-- Posture A on both: RLS on, no policies, service role only. The one writer
-- of both is src/lib/golf/par-evidence-server.ts. Created EMPTY, so the
-- indexes are inline. golf_par_evidence's FK is a named ALTER with a leading
-- index (its primary key leads with course_id). golf_par_changes carries NO
-- foreign key on purpose: the record of a change outlives the course row (an
-- append-only record names its subject, MIGRATIONS.md "An append-only audit
-- table carries NO foreign keys"); it has an index on course_id for the read.
--
-- REVERSAL: DROP TABLE public.golf_par_changes; DROP TABLE public.golf_par_evidence;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 317) THEN
    RAISE EXCEPTION '317 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 316 THEN RAISE EXCEPTION '317 pre-flight: ledger head is %, expected 316', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_courses' AND column_name = 'sheet_sources') THEN
    RAISE EXCEPTION '317 pre-flight: public.golf_courses.sheet_sources is missing — 313 has not run here';
  END IF;
END $$;

-- ── 1. golf_par_evidence ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.golf_par_evidence (
  course_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('golfcourseapi', 'opengolfapi', 'website', 'admin')),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 60),
  votes boolean NOT NULL DEFAULT true,
  pars integer[] NOT NULL CHECK (cardinality(pars) BETWEEN 1 AND 36),
  observed_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.golf_par_evidence DROP CONSTRAINT IF EXISTS golf_par_evidence_pkey;
ALTER TABLE public.golf_par_evidence ADD CONSTRAINT golf_par_evidence_pkey PRIMARY KEY (course_id, source, label);
ALTER TABLE public.golf_par_evidence DROP CONSTRAINT IF EXISTS golf_par_evidence_course_id_fkey;
ALTER TABLE public.golf_par_evidence ADD CONSTRAINT golf_par_evidence_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.golf_courses(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS golf_par_evidence_course_id_idx ON public.golf_par_evidence (course_id);
ALTER TABLE public.golf_par_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.golf_par_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.golf_par_evidence TO service_role;
COMMENT ON TABLE public.golf_par_evidence IS 'Golf (317): what each source said a course''s pars are, one row per source and tee box, kept so a card can be re-judged without asking a provider again (docs/specs/golf-course-data.md). Service role only; the one writer is src/lib/golf/par-evidence-server.ts.';

-- ── 2. golf_par_changes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.golf_par_changes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  course_name text NOT NULL CHECK (char_length(course_name) <= 200),
  hole integer NOT NULL CHECK (hole BETWEEN 1 AND 36),
  from_par integer NOT NULL CHECK (from_par BETWEEN 3 AND 6),
  to_par integer NOT NULL CHECK (to_par BETWEEN 3 AND 6),
  reason text NOT NULL CHECK (reason IN ('settled', 'admin')),
  settled_by text CHECK (settled_by IS NULL OR char_length(settled_by) <= 60),
  actor text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT golf_par_changes_changed_check CHECK (from_par <> to_par)
);
ALTER TABLE public.golf_par_changes DROP CONSTRAINT IF EXISTS golf_par_changes_pkey;
ALTER TABLE public.golf_par_changes ADD CONSTRAINT golf_par_changes_pkey PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS golf_par_changes_course_id_idx ON public.golf_par_changes (course_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS golf_par_changes_changed_at_idx ON public.golf_par_changes (changed_at DESC);
ALTER TABLE public.golf_par_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.golf_par_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.golf_par_changes TO service_role;
COMMENT ON TABLE public.golf_par_changes IS 'Golf (317): the record of every par changed on a saved scorecard, by the app when an independent source settled a disputed hole or by an admin on the console: the hole, from and to, why, who, and what every source said then. No foreign key on purpose (the record outlives the course row). Service role only; the one writer is src/lib/golf/par-evidence-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (317, '317_golf_par_evidence.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 317 APPLIED | 2 | 3 | false | false | 317
SELECT '317 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('golf_par_evidence', 'golf_par_changes')) AS tables_expect_2,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('golf_par_evidence', 'golf_par_changes') AND indexname NOT LIKE '%_pkey') AS indexes_expect_3,
       has_table_privilege('anon', 'public.golf_par_evidence', 'SELECT') AS anon_evidence_expect_false,
       has_table_privilege('authenticated', 'public.golf_par_changes', 'SELECT') AS authenticated_changes_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_317;
