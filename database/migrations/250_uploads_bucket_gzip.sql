-- ============================================================================
-- 250: the uploads bucket admits the activity stream again (application/gzip)
--      — additive; runs on BOTH staging and prod; a regression fix for 249
-- ============================================================================
-- What 249 did: it set `storage.buckets.allowed_mime_types` on `uploads` to
-- the seven image / video types the upload routes accept, "so storage refuses
-- what the app would refuse, before the bytes land". What it forgot: the ONE
-- non-media writer into that bucket — the activity stream
-- (src/lib/activities/write-server.ts uploads every imported run / ride /
-- hike's samples as `application/gzip` at `activities/<profile>/<id>.json.gz`,
-- BEFORE the row is written). Storage refuses the type, `importActivity`
-- answers 500 "Could not save the activity.", and no row is written — so
-- every file import, upload-link delivery and Polar sync has failed since 249
-- ran (Oct 4 2026). Stream-first is why nothing is half-written and why this
-- fix is purely additive: append the one type, nothing to repair.
--
-- The rule from now on (pinned by src/lib/activities/__tests__/server-helpers
-- .test.ts): the bucket's list = EXT_BY_TYPE's keys (upload-rules.ts) plus
-- `application/gzip` (the stream). A new bare `.upload(` writer with another
-- content type needs a migration widening this list, or it fails exactly as
-- 249 made the stream fail.
--
-- Reversal: UPDATE storage.buckets SET allowed_mime_types =
--   array_remove(allowed_mime_types, 'application/gzip') WHERE id = 'uploads';
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 250) THEN
    RAISE EXCEPTION '250 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 249 THEN RAISE EXCEPTION '250 pre-flight: ledger head is %, expected 249', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'uploads') THEN
    RAISE EXCEPTION '250 pre-flight: no uploads bucket here';
  END IF;
END $$;

-- ── 1. The stream's type joins the list (idempotent) ────────────────────────
UPDATE storage.buckets
   SET allowed_mime_types = array_append(allowed_mime_types, 'application/gzip')
 WHERE id = 'uploads'
   AND allowed_mime_types IS NOT NULL
   AND NOT ('application/gzip' = ANY(allowed_mime_types));

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (250, '250_uploads_bucket_gzip.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on both environments: 250 APPLIED | true | 8 | 52428800 | 250
SELECT '250 APPLIED' AS result,
       (SELECT 'application/gzip' = ANY(allowed_mime_types) FROM storage.buckets WHERE id = 'uploads') AS gzip_admitted_expect_true,
       (SELECT coalesce(array_length(allowed_mime_types, 1), 0) FROM storage.buckets WHERE id = 'uploads') AS uploads_types_expect_8,
       (SELECT file_size_limit FROM storage.buckets WHERE id = 'uploads') AS uploads_limit_expect_52428800,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_250;
