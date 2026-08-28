-- ============================================================================
-- 135 — urgent safety-email tier (Family Console Wave 5, PR C)
-- ============================================================================
-- ⚠️ BEFORE RUNNING: find-replace  __CRON_SECRET__  with the real CRON_SECRET
-- value (Vercel env / .env.local). Do NOT commit the substituted file — run
-- it in the SQL editor and discard. A guard below refuses to run while the
-- placeholder is unsubstituted. (059's recipe, verbatim.)
--
-- Today NOTHING is emailed immediately — every notifications row, including
-- safety_alert, reaches an inbox only via the daily digest (≤24h late, and
-- only when email_enabled). This migration gives the two guardian-critical
-- types (safety_alert, consent_result) a ~10-minute path:
--   * notification_preferences.urgent_email_enabled — ON by default (a
--     guardian who never opened settings still gets safety mail; the
--     settings toggle is the opt-out).
--   * notifications.emailed_at — the per-row dedup stamp. Stamped BEFORE the
--     send (reminded_at stance: with a 10-minute loop, double-send is the
--     dominant risk; the nightly digest is the backstop since it keys on the
--     last_digest_at watermark and IGNORES this column entirely).
--   * A new pg_cron job (both Vercel cron slots are taken) hitting
--     /api/cron/urgent-emails every 10 minutes — same template as 059's
--     calendar-reminders job, hardcoded prod URL (previews never fire).
-- ============================================================================

-- Guard: refuses to run while the placeholder is unsubstituted. (Right side
-- is concatenated so a global find-replace only touches real sites.)
DO $guard$ BEGIN
  IF '__CRON_SECRET__' = '__' || 'CRON_SECRET' || '__' THEN
    RAISE EXCEPTION '135: replace __CRON_SECRET__ with the real CRON_SECRET before running';
  END IF;
END $guard$;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS urgent_email_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

-- The sweep's whole working set: unmailed urgent rows only. Partial, so the
-- index stays tiny however large notifications grows.
CREATE INDEX IF NOT EXISTS idx_notifications_urgent_unmailed
  ON notifications (created_at)
  WHERE emailed_at IS NULL AND type IN ('safety_alert', 'consent_result');

COMMENT ON COLUMN notification_preferences.urgent_email_enabled IS
  'Urgent safety emails (safety_alert/consent_result within ~10 min). ON by default; the settings toggle is the opt-out (135).';
COMMENT ON COLUMN notifications.emailed_at IS
  'When the urgent-email sweep mailed this row — stamped BEFORE the send (double-send beats never-send; the daily digest ignores this column) (135).';

NOTIFY pgrst, 'reload schema';

-- ── 10-minute urgent-email trigger (degrades to a WARNING if unavailable) ────
DO $ext$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '135: pg_cron/pg_net unavailable (%) — urgent emails fall back to the daily digest only', SQLERRM;
END $ext$;

DO $job$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'urgent-emails') THEN
      PERFORM cron.unschedule('urgent-emails');
    END IF;
    PERFORM cron.schedule('urgent-emails', '*/10 * * * *', $cmd$
      SELECT net.http_get(
        url := 'https://edge-athlete.vercel.app/api/cron/urgent-emails',
        headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
        timeout_milliseconds := 15000
      )
    $cmd$);
    RAISE NOTICE '135: urgent-emails scheduled (*/10 * * * *)';
  ELSE
    RAISE WARNING '135: extensions missing — urgent-emails NOT scheduled';
  END IF;
END $job$;

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'notification_preferences'
              AND column_name = 'urgent_email_enabled')            AS pref_column_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'notifications'
              AND column_name = 'emailed_at')                      AS stamp_column_ok,
  EXISTS (SELECT 1 FROM pg_indexes
            WHERE indexname = 'idx_notifications_urgent_unmailed') AS index_ok,
  EXISTS (SELECT 1 FROM cron.job
            WHERE jobname = 'urgent-emails' AND active)            AS cron_job_ok,
  EXISTS (SELECT 1 FROM cron.job
            WHERE jobname = 'calendar-reminders' AND active)       AS reminders_still_ok;
