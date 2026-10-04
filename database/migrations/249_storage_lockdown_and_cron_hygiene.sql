-- ============================================================================
-- 249: storage lockdown + background hygiene — the seven client-side storage
--      policies go, the uploads bucket gets a size and type limit, the last
--      bare auth.uid() policies are wrapped, `posts` leaves the realtime
--      publication, and pg_cron's run history is pruned daily
--      (subtractive but UNUSED; runs on BOTH staging and prod; zero app code
--      depends on anything removed here)
-- ============================================================================
-- Tom (Oct 4 2026): "go ahead with the storage rule migration … find ways to
-- make the app run a lot faster without breaking functionality … clean up and
-- test … the file transfer, the apps talking to each other". The speed round's
-- audit found the policies below and the jobs that never stop growing.
-- This file is the round's ONLY DDL:
--
--   1. storage.objects loses its SEVEN app-era policies. Three of them let
--      ANYONE — signed in or not, role `public` — INSERT, UPDATE or DELETE any
--      object in `avatars`; one let anyone INSERT anywhere in `uploads`; three
--      let a signed-in user write under `uploads/<their uid>/`. None is used:
--      every storage write in the app is the service role (the upload routes,
--      the media proxy, the sweep) or a server-signed upload URL (the Oct 4
--      direct upload, src/lib/media/upload-rules.ts — a signed URL carries its
--      own authorization and ignores RLS). No SELECT policy existed since 040.
--      With no policies left, only the service role and signed URLs can touch
--      storage — which is how the app already works. The policies came from
--      pre-ledger files (database/archive/old-migrations/fix-storage-policies.sql,
--      supabase-athlete-schema*.sql) and were re-declared by the baseline.
--   2. The `uploads` bucket gets the server's own limits: 50 MB (the Supabase
--      Free per-file cap; MAX_UPLOAD_BYTES in upload-rules.ts tracks it) and
--      the seven server-allowed types. Storage then refuses what the app
--      would refuse, before the bytes land.
--   3. athlete_equipment's three policies — the last bare `auth.uid()` in the
--      chain — are re-declared with `(select auth.uid())` (126's rule: the
--      planner evaluates it once per statement, not once per row).
--   4. `posts` leaves `supabase_realtime` (added by 041 for a subscriber that
--      never came): every posts write, like-count trigger included, was being
--      processed by realtime for no one.
--   5. A daily `cron-history-prune` job deletes `cron.job_run_details` older
--      than 7 days — the every-minute push-sweep (248) alone adds ~1,440 rows
--      a day and nothing ever removed them — plus a one-time backlog delete.
--      Scheduled ONLY where the `urgent-emails` job already runs (production;
--      staging has no pg_cron jobs, by decision), 248's detector.
--
-- REVERSAL: the seven CREATE POLICY statements in 000_rebuild.sql (the
-- previous baseline); UPDATE storage.buckets SET file_size_limit = NULL,
-- allowed_mime_types = NULL WHERE id = 'uploads'; ALTER PUBLICATION
-- supabase_realtime ADD TABLE public.posts; SELECT cron.unschedule(
-- 'cron-history-prune'). Re-runnable until the ledger row lands; a second run
-- stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 249) THEN
    RAISE EXCEPTION '249 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 248 THEN RAISE EXCEPTION '249 pre-flight: ledger head is %, expected 248', n; END IF;
END $$;

-- ── 1. The seven storage policies ───────────────────────────────────────────
DROP POLICY IF EXISTS "User Delete" ON storage.objects;
DROP POLICY IF EXISTS "User Update" ON storage.objects;
DROP POLICY IF EXISTS "User Upload" ON storage.objects;
DROP POLICY IF EXISTS "User Upload to Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;

-- ── 2. The uploads bucket's limits ──────────────────────────────────────────
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp',
                                  'video/mp4', 'video/quicktime', 'video/webm']::text[]
 WHERE id = 'uploads';

-- ── 3. athlete_equipment: (select auth.uid()) ───────────────────────────────
DROP POLICY IF EXISTS equipment_delete_policy ON public.athlete_equipment;
CREATE POLICY equipment_delete_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS equipment_insert_policy ON public.athlete_equipment;
CREATE POLICY equipment_insert_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS equipment_update_policy ON public.athlete_equipment;
CREATE POLICY equipment_update_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));

-- ── 4. posts leaves the realtime publication ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'posts') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.posts;
    RAISE NOTICE '249: posts removed from supabase_realtime';
  ELSE
    RAISE NOTICE '249: posts was not in supabase_realtime — nothing to do';
  END IF;
END $$;

-- ── 5. cron history: the backlog once, then daily ───────────────────────────
DO $job$
DECLARE removed bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
    GET DIAGNOSTICS removed = ROW_COUNT;
    RAISE NOTICE '249: % old cron run rows removed', removed;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'urgent-emails' AND active) THEN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-history-prune') THEN
        PERFORM cron.unschedule('cron-history-prune');
      END IF;
      PERFORM cron.schedule('cron-history-prune', '17 4 * * *',
        $cmd$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days' $cmd$);
      RAISE NOTICE '249: cron-history-prune scheduled (daily 04:17 UTC)';
    ELSE
      RAISE NOTICE '249: no live urgent-emails job here — cron-history-prune NOT scheduled (expected on staging)';
    END IF;
  ELSE
    RAISE NOTICE '249: pg_cron not installed here — nothing to prune or schedule';
  END IF;
END $job$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (249, '249_storage_lockdown_and_cron_hygiene.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on production: 249 APPLIED | 0 | 52428800 | 7 | 3 | 0 | 1 | 249
-- (staging: the job column reads 0 — no pg_cron jobs there, by decision)
SELECT '249 APPLIED' AS result,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') AS storage_policies_expect_0,
       (SELECT file_size_limit FROM storage.buckets WHERE id = 'uploads') AS uploads_limit_expect_52428800,
       (SELECT coalesce(array_length(allowed_mime_types, 1), 0) FROM storage.buckets WHERE id = 'uploads') AS uploads_types_expect_7,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment'
         AND policyname IN ('equipment_delete_policy', 'equipment_insert_policy', 'equipment_update_policy')
         AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%( SELECT auth.uid() AS uid)%') AS equipment_wrapped_expect_3,
       (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'posts') AS posts_realtime_expect_0,
       (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
                    THEN (SELECT count(*) FROM cron.job WHERE jobname = 'cron-history-prune') ELSE 0 END) AS prune_job_prod_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_249;
