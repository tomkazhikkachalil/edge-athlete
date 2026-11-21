-- ============================================================================
-- 319: golf — a club website that did not ANSWER is asked again after a week,
--      not after a season (Nov 20 2026). Runs on BOTH staging and prod BEFORE
--      the code deploys (the code does not change; the function does).
-- ============================================================================
-- 318 visits a carded course's own website to confirm its pars and waits 90
-- days before the next visit, whatever the visit came to. On production's
-- first four visits three sites did not answer (`unreachable`), one of them a
-- site the same reader had read from another machine an hour earlier. "Did
-- not answer" is not an answer about the card: such a course is due again
-- after 7 days. So is `not_kept` (the card was read and the evidence row
-- could not be saved). Every real answer keeps the 90 days.
--
-- Only golf_site_evidence_due changes. No table, no column, no job.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.golf_site_evidence_due(p_limit integer)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT c.id
    FROM public.golf_courses c
    LEFT JOIN public.golf_course_picks p
      ON p.course_id = c.id
   WHERE c.hole_data IS NOT NULL
     AND c.website IS NOT NULL
     AND btrim(c.website) <> ''
     AND (
       c.site_evidence_at IS NULL
       OR c.site_evidence_at
          < timezone('utc'::text, now()) - interval '90 days'
       OR (
         c.site_evidence_outcome IN ('unreachable', 'not_kept')
         AND c.site_evidence_at
             < timezone('utc'::text, now()) - interval '7 days'
       )
     )
     AND EXISTS (
       SELECT 1
         FROM public.golf_par_evidence a
         JOIN public.golf_par_evidence b
           ON b.course_id = a.course_id
          AND b.source = 'golfcourseapi'
          AND b.votes
          AND b.label > a.label
          AND cardinality(b.pars) = cardinality(a.pars)
          AND b.pars IS DISTINCT FROM a.pars
        WHERE a.course_id = c.id
          AND a.source = 'golfcourseapi'
          AND a.votes
     )
   ORDER BY (p.course_id IS NULL),
            p.picks DESC NULLS LAST,
            c.site_evidence_at NULLS FIRST,
            c.id
   LIMIT greatest(1, least(coalesce(p_limit, 1), 20));
$$;

REVOKE EXECUTE
  ON FUNCTION public.golf_site_evidence_due(integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.golf_site_evidence_due(integer)
  TO service_role;

COMMENT ON FUNCTION public.golf_site_evidence_due IS
  'Carded courses due a website visit to confirm pars; retry after 7 days when the site did not answer (318, 319).';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (319, '319_golf_site_evidence_retry.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 319 APPLIED | 1 | true | false | 319
SELECT '319 APPLIED' AS result,
  (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'golf_site_evidence_due') AS function_expect_1,
  (SELECT pg_get_functiondef(p.oid) LIKE '%7 days%'
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'golf_site_evidence_due') AS retry_expect_true,
  has_function_privilege(
    'anon',
    'public.golf_site_evidence_due(integer)',
    'EXECUTE') AS anon_expect_false,
  (SELECT max(number)
     FROM public.schema_migrations) AS ledger_head_expect_319;
