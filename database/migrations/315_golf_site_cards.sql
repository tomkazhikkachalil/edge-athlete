-- ============================================================================
-- 315: scorecards from a course's own website — golf_courses.site_card_at /
--      site_card_outcome / site_card_url, the queue (index + golf_site_card_due),
--      the pick tracker's 'estimated' kind, and the golf-site-cards schedule
--      (Nov 18 2026; docs/specs/golf-course-data.md, the Nov 18 note). Runs on
--      BOTH staging and prod. Order-safe: the reader answers "migration 315 has
--      not run" and writes nothing until this file has run.
-- ============================================================================
-- Tom (Nov 18): read scorecards from each course's own website, free, with no
-- AI in the app. A course that publishes its card as text (a table on a page,
-- a PDF with text) is read by rule; a picture is not read. A card is saved
-- only when it adds up to its own printed totals, is this course's by name or
-- by its site, and agrees with our row and the map (site-card.ts).
--
--   site_card_at       when the course's website was last VISITED (every visit
--                      is stamped, whatever it came to).
--   site_card_outcome  what the visit came to: ok, or why no card was saved.
--   site_card_url      where the saved card was read (shown to admins).
--
-- Columns on an existing table: golf_courses' grants and policies (public
-- read, service_role write) already cover them. golf_site_card_due is the
-- queue: courses people picked first. SECURITY INVOKER, service_role only.
-- golf_course_picks.card gains 'estimated' (a map card whose pars are
-- estimated from hole length, #1567): its own kind in the tracker.
-- The schedule is created only where urgent-emails already runs (production).
-- Reversal: SELECT cron.unschedule('golf-site-cards'); DROP FUNCTION
-- public.golf_site_card_due(integer); DROP INDEX public.idx_golf_courses_site_card;
-- ALTER TABLE public.golf_courses DROP COLUMN site_card_at, DROP COLUMN
-- site_card_outcome, DROP COLUMN site_card_url; and the picks check back to
-- ('provider','map','none') after UPDATE … SET card = 'map' WHERE card = 'estimated'.
-- ============================================================================

DO $$
DECLARE n int;
BEGIN
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 314 THEN RAISE EXCEPTION '315 pre-flight: ledger head is %, expected 314', n; END IF;
END $$;

ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS site_card_at timestamptz,
  ADD COLUMN IF NOT EXISTS site_card_outcome text,
  ADD COLUMN IF NOT EXISTS site_card_url text;

COMMENT ON COLUMN public.golf_courses.site_card_at IS
  'When the scorecard reader last visited this course''s own website (migration 315). NULL = never visited.';
COMMENT ON COLUMN public.golf_courses.site_card_outcome IS
  'What the last website visit came to: ok, or why no card was saved (migration 315).';
COMMENT ON COLUMN public.golf_courses.site_card_url IS
  'Where on the course''s own website the saved scorecard was read (migration 315).';

-- The queue: courses with a website and no card (13k rows of 29k — inline).
CREATE INDEX IF NOT EXISTS idx_golf_courses_site_card
  ON public.golf_courses (site_card_at NULLS FIRST, id)
  WHERE website IS NOT NULL AND hole_data IS NULL;

CREATE OR REPLACE FUNCTION public.golf_site_card_due(p_limit integer)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT c.id
    FROM public.golf_courses c
    LEFT JOIN public.golf_course_picks p ON p.course_id = c.id
   WHERE c.website IS NOT NULL AND btrim(c.website) <> ''
     AND c.hole_data IS NULL
     AND (c.site_card_at IS NULL OR c.site_card_at < timezone('utc'::text, now()) - interval '90 days')
   ORDER BY (p.course_id IS NULL), p.picks DESC NULLS LAST, c.site_card_at NULLS FIRST, c.id
   LIMIT greatest(1, least(coalesce(p_limit, 2), 20));
$$;
REVOKE EXECUTE ON FUNCTION public.golf_site_card_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_site_card_due(integer) TO service_role;
COMMENT ON FUNCTION public.golf_site_card_due IS 'Courses whose own website is due a scorecard visit: a website, no card, never visited or over 90 days ago; picked courses first (315).';

-- The pick tracker's kinds: an estimated map card is its own kind.
ALTER TABLE public.golf_course_picks DROP CONSTRAINT IF EXISTS golf_course_picks_card_check;
ALTER TABLE public.golf_course_picks ADD CONSTRAINT golf_course_picks_card_check CHECK (card IN ('provider', 'map', 'estimated', 'none'));

NOTIFY pgrst, 'reload schema';

-- ── The schedule (only where urgent-emails already runs) ────────────────────
DO $job$
DECLARE
  auth_header text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT substring(command FROM 'Bearer [^'']+') INTO auth_header
      FROM cron.job WHERE jobname = 'urgent-emails' AND active LIMIT 1;
    IF auth_header IS NULL OR auth_header LIKE '%__CRON_SECRET__%' THEN
      RAISE NOTICE '315: no live urgent-emails job here — golf-site-cards NOT scheduled (expected on staging)';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'golf-site-cards') THEN
        PERFORM cron.unschedule('golf-site-cards');
      END IF;
      PERFORM cron.schedule('golf-site-cards', '*/5 * * * *', format($cmd$
        SELECT net.http_post(
          url := 'https://edgeathlete.ca/api/cron/golf-site-cards',
          headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
      $cmd$, auth_header));
      RAISE NOTICE '315: golf-site-cards scheduled (every 5 minutes)';
    END IF;
  ELSE
    RAISE NOTICE '315: pg_cron/pg_net not installed here — golf-site-cards NOT scheduled';
  END IF;
END $job$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (315, '315_golf_site_cards.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on production: 315 APPLIED | 3 | 1 | false | true | 1 | 315
-- (staging: the job column reads 0 — no pg_cron jobs there, by decision)
SELECT '315 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_courses' AND column_name IN ('site_card_at', 'site_card_outcome', 'site_card_url')) AS columns_expect_3,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_courses_site_card') AS index_expect_1,
       has_function_privilege('anon', 'public.golf_site_card_due(integer)', 'EXECUTE') AS anon_executes_expect_false,
       (SELECT pg_get_constraintdef(oid) LIKE '%estimated%' FROM pg_constraint WHERE conname = 'golf_course_picks_card_check') AS picks_kind_expect_true,
       (SELECT count(*) FROM cron.job WHERE jobname = 'golf-site-cards') AS cron_job_prod_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_315;
