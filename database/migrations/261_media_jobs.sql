-- ============================================================================
-- 261: video posters + never-broken media — the data shape and the job table
--      (Oct 13 2026; the program's FIRST of two DDL files — 262 is the cron
--      schedule; runs on BOTH staging and prod BEFORE PR 6 (blur) and PR 7
--      (the worker) deploy — their code reads a missing column as "none")
-- ============================================================================
-- Tom's decisions: an iPhone's HEVC/MOV clip is converted SERVER-SIDE by a
-- background job on a Vercel function (ffmpeg), which also extracts a poster
-- for any video without one (older posts included) and a blur hash where
-- missing; readers carry a `processing` state until the playable file
-- exists. The blur placeholder is a STORED ThumbHash.
--
-- The model (every new column nullable; nothing here changes a reader):
--   post_media / activity_media
--     codec                 the video track's codec the server read at
--                           completion (avc · hevc · vp8 · vp9 · av1 ·
--                           unknown); NULL on images and on rows from before.
--     processing_at         set at insert ONLY when the codec needs the
--                           transcode and the worker is on; NULL = playable
--                           as stored. The reader emits `processing`, never
--                           the timestamp. Cleared by the job's done, its
--                           third failure, or the daily hygiene (24 h).
--     blur_hash             a ThumbHash (base64, 8..64 chars) — the blurred
--                           placeholder every surface paints while the real
--                           picture loads; computed on the device at attach,
--                           by the job for older media.
--     transcode_source_url  the PRE-transcode original, kept forever
--                           (convention 27's spirit). NOT `source_url`: the
--                           deferred-original PATCH sets that once (409
--                           after) and `rehydrate.ts` re-edits FROM it — an
--                           HEVC file there would open undecodable on
--                           Android. The storage sweep keeps it (a
--                           URL_SOURCE_COLUMNS entry).
--   media_jobs (posture A: RLS on, zero policies, service_role only)
--     one row per unit of work: kind video | poster | blur | probe; a
--     polymorphic target (table + id, bare uuid — no FK on purpose: the
--     row may be deleted under a running job, which then marks itself
--     skipped); the source's bucket path; status queued → running → done |
--     parked (retry after run_after) | failed (3 attempts) | skipped;
--     the outputs (a mirrored copy with the same source_path reuses them);
--     origin upload | mirror | backfill.
--   media_jobs_claim(n, lease, max_running)
--     FOR UPDATE SKIP LOCKED + a lease (255's shape): videos first, a
--     running cap (Hobby's one vCPU = one transcode at a time), an expired
--     lease reclaimable. Service role only — `private` cannot hold an RPC
--     supabase-js calls (257).
--
-- Pre-flight: ledger head 260. Deploy order: FLEXIBLE — nothing reads the
-- columns until PR 6/7 deploy, and they read a missing column as "none".
-- REVERSAL (data-safe): drop the function and the table; the eight columns
-- and the two partial indexes are additive and may stay.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 261) THEN
    RAISE EXCEPTION '261 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 260 THEN RAISE EXCEPTION '261 pre-flight: ledger head is %, expected 260', n; END IF;
END $$;

-- ── 1. The reader columns on post_media and activity_media ──────────────────
ALTER TABLE public.post_media
  ADD COLUMN IF NOT EXISTS codec text,
  ADD COLUMN IF NOT EXISTS processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS blur_hash text,
  ADD COLUMN IF NOT EXISTS transcode_source_url text;
ALTER TABLE public.post_media DROP CONSTRAINT IF EXISTS post_media_codec_check;
ALTER TABLE public.post_media ADD CONSTRAINT post_media_codec_check
  CHECK (codec IS NULL OR codec IN ('avc', 'hevc', 'vp8', 'vp9', 'av1', 'unknown'));
ALTER TABLE public.post_media DROP CONSTRAINT IF EXISTS post_media_blur_hash_check;
ALTER TABLE public.post_media ADD CONSTRAINT post_media_blur_hash_check
  CHECK (blur_hash IS NULL OR length(blur_hash) BETWEEN 8 AND 64);
ALTER TABLE public.post_media DROP CONSTRAINT IF EXISTS post_media_transcode_source_check;
ALTER TABLE public.post_media ADD CONSTRAINT post_media_transcode_source_check
  CHECK (transcode_source_url IS NULL OR length(transcode_source_url) BETWEEN 1 AND 2000);
-- The worker's "what is still converting" read — a partial index, sub-second inline on this table.
CREATE INDEX IF NOT EXISTS idx_post_media_processing ON public.post_media (processing_at) WHERE processing_at IS NOT NULL;

ALTER TABLE public.activity_media
  ADD COLUMN IF NOT EXISTS codec text,
  ADD COLUMN IF NOT EXISTS processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS blur_hash text,
  ADD COLUMN IF NOT EXISTS transcode_source_url text;
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_codec_check;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_codec_check
  CHECK (codec IS NULL OR codec IN ('avc', 'hevc', 'vp8', 'vp9', 'av1', 'unknown'));
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_blur_hash_check;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_blur_hash_check
  CHECK (blur_hash IS NULL OR length(blur_hash) BETWEEN 8 AND 64);
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_transcode_source_check;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_transcode_source_check
  CHECK (transcode_source_url IS NULL OR length(transcode_source_url) BETWEEN 1 AND 2000);
CREATE INDEX IF NOT EXISTS idx_activity_media_processing ON public.activity_media (processing_at) WHERE processing_at IS NOT NULL;

COMMENT ON COLUMN public.post_media.codec IS 'The video track''s codec the server read at upload completion (261): avc · hevc · vp8 · vp9 · av1 · unknown; NULL on images and on rows from before.';
COMMENT ON COLUMN public.post_media.processing_at IS 'Set at insert only when the codec needs the server transcode (261); NULL = playable as stored. The reader emits a boolean, never this.';
COMMENT ON COLUMN public.post_media.blur_hash IS 'A ThumbHash (base64) — the blurred placeholder painted while the picture loads (261). Computed on the device at attach; the media job fills older rows.';
COMMENT ON COLUMN public.post_media.transcode_source_url IS 'The pre-transcode original, kept forever (261). Never source_url: that is the edit original the re-edit path reads.';
COMMENT ON COLUMN public.activity_media.codec IS 'As post_media.codec (261).';
COMMENT ON COLUMN public.activity_media.processing_at IS 'As post_media.processing_at (261).';
COMMENT ON COLUMN public.activity_media.blur_hash IS 'As post_media.blur_hash (261).';
COMMENT ON COLUMN public.activity_media.transcode_source_url IS 'As post_media.transcode_source_url (261).';

-- ── 2. The job table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_jobs (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  kind          text NOT NULL CONSTRAINT media_jobs_kind_check CHECK (kind IN ('video', 'poster', 'blur', 'probe')),
  target_table  text NOT NULL CONSTRAINT media_jobs_target_table_check CHECK (target_table IN ('post_media', 'activity_media')),
  target_id     uuid NOT NULL,
  owner_id      uuid NOT NULL,
  source_path   text NOT NULL CONSTRAINT media_jobs_source_path_check CHECK (length(source_path) BETWEEN 1 AND 2000),
  status        text NOT NULL DEFAULT 'queued' CONSTRAINT media_jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'parked', 'failed', 'skipped')),
  attempts      integer NOT NULL DEFAULT 0 CONSTRAINT media_jobs_attempts_check CHECK (attempts >= 0),
  run_after     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  error         text CONSTRAINT media_jobs_error_check CHECK (error IS NULL OR length(error) <= 2000),
  output_url    text CONSTRAINT media_jobs_output_check CHECK (output_url IS NULL OR length(output_url) BETWEEN 1 AND 2000),
  poster_url    text CONSTRAINT media_jobs_poster_check CHECK (poster_url IS NULL OR length(poster_url) BETWEEN 1 AND 2000),
  blur_hash     text CONSTRAINT media_jobs_blur_check CHECK (blur_hash IS NULL OR length(blur_hash) BETWEEN 8 AND 64),
  origin        text NOT NULL DEFAULT 'upload' CONSTRAINT media_jobs_origin_check CHECK (origin IN ('upload', 'mirror', 'backfill')),
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.media_jobs DROP CONSTRAINT IF EXISTS media_jobs_pkey;
ALTER TABLE public.media_jobs ADD CONSTRAINT media_jobs_pkey PRIMARY KEY (id);
-- One OPEN job per target: a second enqueue is a no-op (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS media_jobs_one_open ON public.media_jobs (target_table, target_id)
  WHERE status IN ('queued', 'running', 'parked');
-- The claim's read: what is due, oldest first.
CREATE INDEX IF NOT EXISTS idx_media_jobs_due ON public.media_jobs (status, run_after, created_at);
-- A mirrored copy reuses a done job's outputs by its source.
CREATE INDEX IF NOT EXISTS idx_media_jobs_source_done ON public.media_jobs (source_path) WHERE status = 'done';
ALTER TABLE public.media_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_jobs FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.media_jobs IS 'The media worker''s queue (261): one row per unit of work on a post_media / activity_media row — a transcode, a poster, a blur hash, a probe. Posture A; claimed by media_jobs_claim; outputs recorded so a mirrored copy of the same file reuses them.';
COMMENT ON COLUMN public.media_jobs.target_id IS 'The media row''s id — polymorphic over target_table, so no FK: a row deleted under a running job makes it skipped.';

-- ── 3. The claim ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.media_jobs_claim(integer, integer, integer);
CREATE FUNCTION public.media_jobs_claim(p_n integer, p_lease_seconds integer, p_max_running integer)
RETURNS SETOF public.media_jobs
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH running AS (
    SELECT count(*) AS n FROM public.media_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at > timezone('utc'::text, now()) - make_interval(secs => GREATEST(p_lease_seconds, 1))
  ), picked AS (
    -- The running count enters as scalar subqueries: LIMIT may not name a row variable (42P10).
    SELECT j.id FROM public.media_jobs j
     WHERE (SELECT n FROM running) < GREATEST(p_max_running, 1)
       AND (
         (j.status IN ('queued', 'parked') AND j.run_after <= timezone('utc'::text, now()))
         OR (j.status = 'running' AND (j.claimed_at IS NULL OR j.claimed_at < timezone('utc'::text, now()) - make_interval(secs => GREATEST(p_lease_seconds, 1))))
       )
     ORDER BY CASE j.kind WHEN 'video' THEN 0 WHEN 'probe' THEN 1 WHEN 'poster' THEN 2 ELSE 3 END, j.created_at
     LIMIT GREATEST(LEAST(p_n, GREATEST(p_max_running, 1) - (SELECT n FROM running)), 0)
     FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.media_jobs j
     SET status = 'running',
         claimed_at = timezone('utc'::text, now()),
         attempts = j.attempts + 1
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
$$;
REVOKE EXECUTE ON FUNCTION public.media_jobs_claim(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_jobs_claim(integer, integer, integer) TO service_role;
COMMENT ON FUNCTION public.media_jobs_claim IS 'Claim up to n due media jobs (261) under a lease, videos first, within a running cap; an expired lease is reclaimable. FOR UPDATE SKIP LOCKED — a cron tick and the dashboard may overlap. Service role only.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (261, '261_media_jobs.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on both environments: 261 APPLIED | 4 | 4 | 1 | 1 | 261
SELECT '261 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_media'
         AND column_name IN ('codec', 'processing_at', 'blur_hash', 'transcode_source_url')) AS post_media_cols_expect_4,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activity_media'
         AND column_name IN ('codec', 'processing_at', 'blur_hash', 'transcode_source_url')) AS activity_media_cols_expect_4,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'media_jobs') AS jobs_table_expect_1,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'media_jobs_claim') AS claim_fn_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_261;
