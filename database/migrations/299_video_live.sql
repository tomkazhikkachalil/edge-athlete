-- ============================================================================
-- 299: live — a linked YouTube broadcast the app knows is live (Nov 5 2026;
--      the Videos program, Phase 4a). Runs on BOTH staging and prod BEFORE
--      the code deploys (the code reads the new columns).
-- ============================================================================
-- A YouTube broadcast is a video with the SAME id before, during and after
-- the stream, so the archive is the `videos` row that already exists. Five
-- nullable-or-defaulted columns say what YouTube last said about it:
--
--   live_status         none (a plain video, the default) | upcoming | live | ended
--   scheduled_start_at  YouTube's scheduledStartTime
--   live_started_at     actualStartTime — the ZERO of every marker made live
--   live_ended_at       actualEndTime
--   live_checked_at     when the state was last read from YouTube. The
--                       refresh's own lock: a conditional UPDATE on it claims
--                       the read (src/lib/videos/videos-live-server.ts), so
--                       many viewers cost one Data API unit per TTL, never
--                       one each. Reader-driven — there is no cron.
--
-- The partial index serves the Live Now read and the sweep of stale states;
-- a plain video never enters it. No FK, no grant change (296's posture A and
-- the service_role grant cover the columns).
--
-- REVERSAL: ALTER TABLE public.videos DROP COLUMN live_status, DROP COLUMN
-- scheduled_start_at, DROP COLUMN live_started_at, DROP COLUMN live_ended_at,
-- DROP COLUMN live_checked_at; (the index and the CHECK go with them).
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 299) THEN
    RAISE EXCEPTION '299 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 298 THEN RAISE EXCEPTION '299 pre-flight: ledger head is %, expected 298', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'videos') THEN
    RAISE EXCEPTION '299 pre-flight: public.videos is missing — 296 has not run here';
  END IF;
END $$;

-- ── 1. The columns ──────────────────────────────────────────────────────────
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS live_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS live_started_at timestamptz;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS live_ended_at timestamptz;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS live_checked_at timestamptz;

ALTER TABLE public.videos DROP CONSTRAINT IF EXISTS videos_live_status_check;
ALTER TABLE public.videos ADD CONSTRAINT videos_live_status_check CHECK (live_status IN ('none', 'upcoming', 'live', 'ended'));

-- ── 2. The index: the broadcasts that are or will be live ───────────────────
CREATE INDEX IF NOT EXISTS videos_live_idx ON public.videos (live_status, scheduled_start_at) WHERE live_status IN ('upcoming', 'live');

COMMENT ON COLUMN public.videos.live_status IS 'Phase 4a (299): none | upcoming | live | ended — what YouTube last said; read when someone looks (videos-live-server.ts), never by a cron.';
COMMENT ON COLUMN public.videos.live_started_at IS 'Phase 4a (299): YouTube''s actualStartTime — the zero of a marker made during the stream.';
COMMENT ON COLUMN public.videos.live_checked_at IS 'Phase 4a (299): the last read of the live state; the conditional-UPDATE lock that makes many viewers one read.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (299, '299_video_live.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 299 APPLIED | 5 | 299
SELECT '299 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'videos' AND column_name IN ('live_status', 'scheduled_start_at', 'live_started_at', 'live_ended_at', 'live_checked_at')) AS columns_expect_5,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_299;
