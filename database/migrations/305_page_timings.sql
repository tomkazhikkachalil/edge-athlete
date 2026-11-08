-- ============================================================================
-- 305: page_timings — real-user timing by BUILD (the performance program,
--      Phase 0.4 — Nov 7 2026; Tom's decision: a first-party table, not
--      Vercel Speed Insights). Runs on BOTH staging and prod; the code
--      deploys either way (POST /api/page-timings answers 204 and drops the beacon
--      while the table is missing).
-- ============================================================================
-- Tom: "when I make updates, the app slows down a lot." Nothing measured it:
-- Speed Insights has been off since March, no beacon existed. This table is
-- the instrument that answers "did THIS deploy make it slower" for the life
-- of the project: one row per browser timing metric a page view reports, keyed by
-- the build (the deploy's commit, NEXT_PUBLIC_BUILD_ID), the route (ids
-- masked), the metric, its value and the browser's own rating, the device
-- class and the navigation type. NO person: no user id, no IP, no user
-- agent — a number about a build, not about anyone (the 252 posture).
--
--   page_timings — append-only; 30 days (the daily cron prunes); the admin
--     console reads p75 per build (src/lib/observability/page-timings-server.ts).
--   Posture A: RLS on, no policies, service role only; the writer is
--   POST /api/page-timings (an IP bucket, 60 a minute); the reader is the admin
--   console's GET /api/admin/page-timings.
--
-- REVERSAL: DROP TABLE public.page_timings;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 305) THEN
    RAISE EXCEPTION '305 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 304 THEN RAISE EXCEPTION '305 pre-flight: ledger head is %, expected 304', n; END IF;
END $$;

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.page_timings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  received_at timestamptz NOT NULL DEFAULT now(),
  build text NOT NULL,
  route text NOT NULL,
  metric text NOT NULL,
  value numeric(12,3) NOT NULL,
  rating text,
  device text NOT NULL,
  navigation text,
  signed_in boolean NOT NULL DEFAULT false
);
ALTER TABLE public.page_timings DROP CONSTRAINT IF EXISTS page_timings_pkey;
ALTER TABLE public.page_timings ADD CONSTRAINT page_timings_pkey PRIMARY KEY (id);
ALTER TABLE public.page_timings DROP CONSTRAINT IF EXISTS page_timings_metric_check;
ALTER TABLE public.page_timings ADD CONSTRAINT page_timings_metric_check CHECK (metric IN ('LCP', 'INP', 'CLS', 'TTFB', 'FCP'));
ALTER TABLE public.page_timings DROP CONSTRAINT IF EXISTS page_timings_device_check;
ALTER TABLE public.page_timings ADD CONSTRAINT page_timings_device_check CHECK (device IN ('phone', 'tablet', 'desktop'));

-- The reader's shape: a build's rows, newest first; the pruner's: by age.
CREATE INDEX IF NOT EXISTS page_timings_build_received_idx ON public.page_timings (build, received_at DESC);
CREATE INDEX IF NOT EXISTS page_timings_received_idx ON public.page_timings (received_at);

ALTER TABLE public.page_timings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.page_timings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.page_timings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.page_timings_id_seq TO service_role;
COMMENT ON TABLE public.page_timings IS 'Real-user page timings by build (305): one row per browser timing metric (LCP, INP, CLS, TTFB, FCP) a page view reported — build, route (ids masked), metric, value, rating, device, navigation, signed_in. No person. 30 days; the daily cron prunes. Posture A; the writer is POST /api/page-timings, the reader the admin console.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (305, '305_page_timings.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 305 APPLIED | 1 | false | 305
SELECT '305 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'page_timings') AS tables_expect_1,
       has_table_privilege('anon', 'public.page_timings', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_305;
