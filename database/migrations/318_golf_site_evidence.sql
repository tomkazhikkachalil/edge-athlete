-- ============================================================================
-- 318: golf — the course's own website as a CONFIRMATION of a saved card's
--      pars (Nov 20 2026). Runs on BOTH staging and prod BEFORE the code
--      deploys.
-- ============================================================================
-- Since the evening of Nov 20 a hole whose tees disagree on par is decided by
-- logic and waits for nobody (src/lib/golf/par-evidence.ts). Confirmations
-- from sources other than the provider's tees can still settle such a hole,
-- and the strongest is the club's own published scorecard. The website reader
-- (315) only ever visited courses with NO card; a disputed hole exists only
-- on a course that has one.
--
--   golf_courses.site_evidence_at / site_evidence_outcome — when a carded
--     course's own website was last visited for its pars, and what the visit
--     came to. Separate from site_card_at / site_card_outcome (315), which
--     stamp the visits that look for a card to SAVE.
--   golf_site_evidence_due(p_limit) — the courses due such a visit: a saved
--     card, a website, two voting tee boxes of the provider that disagree,
--     and never visited or over 90 days ago; picked courses first.
--
-- The visit writes one `website` row to golf_par_evidence (317) and never the
-- card. No new job: the same five-minute tick as 315, the same two visits a
-- tick and the same daily cap. No table is created, so there is no new grant;
-- the function is service-role only.
-- ============================================================================

ALTER TABLE public.golf_courses ADD COLUMN IF NOT EXISTS site_evidence_at timestamptz;
ALTER TABLE public.golf_courses ADD COLUMN IF NOT EXISTS site_evidence_outcome text;
ALTER TABLE public.golf_courses DROP CONSTRAINT IF EXISTS golf_courses_site_evidence_outcome_check;
ALTER TABLE public.golf_courses ADD CONSTRAINT golf_courses_site_evidence_outcome_check CHECK (site_evidence_outcome IS NULL OR char_length(site_evidence_outcome) <= 40);
COMMENT ON COLUMN public.golf_courses.site_evidence_at IS
  'When this carded course''s own website was last visited to confirm its pars (migration 318).';
COMMENT ON COLUMN public.golf_courses.site_evidence_outcome IS
  'What that visit came to: ok (a website row was kept in golf_par_evidence), other_card, or the reader''s own outcomes (migration 318).';

CREATE OR REPLACE FUNCTION public.golf_site_evidence_due(p_limit integer)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT c.id
    FROM public.golf_courses c
    LEFT JOIN public.golf_course_picks p ON p.course_id = c.id
   WHERE c.hole_data IS NOT NULL
     AND c.website IS NOT NULL AND btrim(c.website) <> ''
     AND (c.site_evidence_at IS NULL OR c.site_evidence_at < timezone('utc'::text, now()) - interval '90 days')
     AND EXISTS (
       SELECT 1
         FROM public.golf_par_evidence a
         JOIN public.golf_par_evidence b
           ON b.course_id = a.course_id AND b.source = 'golfcourseapi' AND b.votes
          AND b.label > a.label
          AND cardinality(b.pars) = cardinality(a.pars)
          AND b.pars IS DISTINCT FROM a.pars
        WHERE a.course_id = c.id AND a.source = 'golfcourseapi' AND a.votes
     )
   ORDER BY (p.course_id IS NULL), p.picks DESC NULLS LAST, c.site_evidence_at NULLS FIRST, c.id
   LIMIT greatest(1, least(coalesce(p_limit, 1), 20));
$$;
REVOKE EXECUTE ON FUNCTION public.golf_site_evidence_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_site_evidence_due(integer) TO service_role;
COMMENT ON FUNCTION public.golf_site_evidence_due IS 'Carded courses whose own website is due a visit to confirm their pars: a card, a website, two voting provider tee boxes that disagree, never visited or over 90 days ago; picked courses first (318).';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (318, '318_golf_site_evidence.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 318 APPLIED | 2 | 1 | false | false | 318
SELECT '318 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_courses' AND column_name IN ('site_evidence_at', 'site_evidence_outcome')) AS columns_expect_2,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'golf_site_evidence_due') AS function_expect_1,
       has_function_privilege('anon', 'public.golf_site_evidence_due(integer)', 'EXECUTE') AS anon_expect_false,
       has_function_privilege('authenticated', 'public.golf_site_evidence_due(integer)', 'EXECUTE') AS authenticated_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_318;
